import { Injectable, ServiceUnavailableException } from '@nestjs/common';

type YouTubeSearchItem = {
  id?: { videoId?: string; playlistId?: string };
  snippet?: {
    title?: string;
    description?: string;
    channelTitle?: string;
    publishedAt?: string;
    thumbnails?: {
      medium?: { url?: string };
      high?: { url?: string };
      default?: { url?: string };
    };
  };
};

type Candidate = {
  id: string;
  type: 'video' | 'playlist';
  rank: number;
  title: string;
  description: string;
  channelTitle: string;
  publishedAt: string;
  thumbnailUrl: string;
  watchUrl: string;
};

type CourseRecommendation = Omit<Candidate, 'id' | 'rank' | 'description'> & {
  language: 'English' | 'Hindi';
  viewCount?: number;
  likeCount?: number;
  itemCount?: number;
};

type SkillRecommendations = {
  skill: string;
  videos: CourseRecommendation[];
  playlists: CourseRecommendation[];
  unavailable: boolean;
};

type CacheEntry = { expiresAt: number; result: SkillRecommendations };
type VideoDetails = {
  id: string;
  snippet?: { defaultLanguage?: string; defaultAudioLanguage?: string };
  statistics?: { viewCount?: string; likeCount?: string };
};
type PlaylistDetails = {
  id: string;
  snippet?: { defaultLanguage?: string };
  contentDetails?: { itemCount?: number };
};
type SkillSearchResult = {
  skill: string;
  cacheKey: string;
  candidates?: CandidateGroups;
  cachedResult?: SkillRecommendations;
  unavailable?: boolean;
};

@Injectable()
export class YouTubeCoursesService {
  private readonly apiKey = process.env.YOUTUBE_API_KEY;
  private readonly cacheTtlMs = 12 * 60 * 60 * 1000;
  private readonly cache = new Map<string, CacheEntry>();

  async recommendForSkills(input: string[]): Promise<SkillRecommendations[]> {
    const skills = [...new Set(
      input
        .filter((skill): skill is string => typeof skill === 'string')
        .map((skill) => skill.trim().slice(0, 80))
        .filter(Boolean),
    )].slice(0, 5);

    const results: SkillSearchResult[] = await Promise.all(skills.map(async (skill) => {
      const cacheKey = `v4:IN:${skill.toLocaleLowerCase()}`;
      const cached = this.cache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        return { skill, cacheKey, cachedResult: cached.result };
      }
      if (cached) this.cache.delete(cacheKey);

      try {
        const candidates = await this.searchSkill(skill);
        return { skill, cacheKey, candidates };
      } catch {
        return {
          skill,
          cacheKey,
          candidates: { videos: [], playlists: [] } as CandidateGroups,
          unavailable: true,
        };
      }
    }));

    const videoIds = [...new Set(results.flatMap((result) => result.candidates?.videos.map((item) => item.id) ?? []))];
    const playlistIds = [...new Set(results.flatMap((result) => result.candidates?.playlists.map((item) => item.id) ?? []))];
    const [videoDetails, playlistDetails] = await Promise.all([
      this.getVideoDetails(videoIds).catch(() => new Map<string, VideoDetails>()),
      this.getPlaylistDetails(playlistIds).catch(() => new Map<string, PlaylistDetails>()),
    ]);

    return results.map((result) => {
      if (result.cachedResult) return result.cachedResult;
      if (result.unavailable || !result.candidates) {
        return { skill: result.skill, videos: [], playlists: [], unavailable: true };
      }

      const videos = this.rankCandidates(result.skill, result.candidates.videos, videoDetails, playlistDetails)
        .slice(0, 3);
      const playlists = this.rankCandidates(result.skill, result.candidates.playlists, videoDetails, playlistDetails)
        .slice(0, 2);
      const response = { skill: result.skill, videos, playlists, unavailable: false };
      this.cache.set(result.cacheKey, { result: response, expiresAt: Date.now() + this.cacheTtlMs });
      return response;
    });
  }

  private async searchSkill(skill: string): Promise<CandidateGroups> {
    if (!this.apiKey) {
      throw new ServiceUnavailableException('YouTube course search is not configured.');
    }

    const searchPhrase = skill.trim().toLowerCase() === 'ai'
      ? '"artificial intelligence" machine learning'
      : skill;
    const [videoSearch, playlistSearch] = await Promise.allSettled([
      this.search('video', `${searchPhrase} full course tutorial`, 10),
      this.search('playlist', `${searchPhrase} full course playlist tutorial`, 8),
    ]);
    if (videoSearch.status === 'rejected' && playlistSearch.status === 'rejected') {
      throw videoSearch.reason;
    }
    return {
      videos: videoSearch.status === 'fulfilled' ? videoSearch.value : [],
      playlists: playlistSearch.status === 'fulfilled' ? playlistSearch.value : [],
    };
  }

  private async search(
    type: 'video' | 'playlist',
    query: string,
    maxResults: number,
  ): Promise<Candidate[]> {
    const url = new URL('https://www.googleapis.com/youtube/v3/search');
    url.search = new URLSearchParams({
      part: 'snippet',
      type,
      q: query,
      maxResults: String(maxResults),
      order: 'relevance',
      ...(type === 'video' ? { videoDuration: 'long' } : {}),
      regionCode: 'IN',
    }).toString();

    const response = await fetch(url, {
      headers: { 'x-goog-api-key': this.apiKey as string },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      throw new ServiceUnavailableException('YouTube course search is temporarily unavailable.');
    }

    const payload = await response.json() as { items?: YouTubeSearchItem[] };
    return (payload.items ?? []).flatMap((item, rank) => {
      const id = type === 'video' ? item.id?.videoId : item.id?.playlistId;
      if (!id) return [];
      const snippet = item.snippet ?? {};
      return [{
        id,
        type,
        rank,
        title: snippet.title ?? (type === 'video' ? 'YouTube video' : 'YouTube playlist'),
        description: snippet.description ?? '',
        channelTitle: snippet.channelTitle ?? 'YouTube creator',
        publishedAt: snippet.publishedAt ?? '',
        thumbnailUrl: snippet.thumbnails?.high?.url ?? snippet.thumbnails?.medium?.url ?? snippet.thumbnails?.default?.url ?? '',
        watchUrl: type === 'video'
          ? `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`
          : `https://www.youtube.com/playlist?list=${encodeURIComponent(id)}`,
      }];
    });
  }

  private async getVideoDetails(ids: string[]): Promise<Map<string, VideoDetails>> {
    if (!ids.length) return new Map();
    const url = new URL('https://www.googleapis.com/youtube/v3/videos');
    url.search = new URLSearchParams({ part: 'snippet,statistics', id: ids.slice(0, 50).join(',') }).toString();
    const response = await fetch(url, {
      headers: { 'x-goog-api-key': this.apiKey as string },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new ServiceUnavailableException('YouTube video details are unavailable.');
    const payload = await response.json() as { items?: VideoDetails[] };
    return new Map((payload.items ?? []).map((item) => [item.id, item]));
  }

  private async getPlaylistDetails(ids: string[]): Promise<Map<string, PlaylistDetails>> {
    if (!ids.length) return new Map();
    const url = new URL('https://www.googleapis.com/youtube/v3/playlists');
    url.search = new URLSearchParams({ part: 'snippet,contentDetails', id: ids.slice(0, 50).join(',') }).toString();
    const response = await fetch(url, {
      headers: { 'x-goog-api-key': this.apiKey as string },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new ServiceUnavailableException('YouTube playlist details are unavailable.');
    const payload = await response.json() as { items?: PlaylistDetails[] };
    return new Map((payload.items ?? []).map((item) => [item.id, item]));
  }

  private rankCandidates(
    skill: string,
    candidates: Candidate[],
    videoDetails: Map<string, VideoDetails>,
    playlistDetails: Map<string, PlaylistDetails>,
  ): CourseRecommendation[] {
    const topicCandidates = skill.trim().toLowerCase() === 'ai'
      ? candidates.filter((candidate) => {
        const title = candidate.title.toLowerCase();
        const matchesAiTopic = /\b(artificial intelligence|machine learning|deep learning|generative ai|neural networks?|llms?|large language models?)\b/i.test(title);
        const isAnotherTopic = /\b(excel|spreadsheet|microsoft office|powerpoint|word processing)\b/i.test(title);
        return matchesAiTopic && !isAnotherTopic;
      })
      : candidates;
    const languageById = new Map<string, 'English' | 'Hindi'>();
    const relevantCandidates = topicCandidates.filter((candidate) => {
      const language = this.getCourseLanguage(candidate, videoDetails, playlistDetails);
      if (!language) return false;
      languageById.set(candidate.id, language);
      return true;
    });
    const maxViews = Math.max(1, ...relevantCandidates.map((item) => Number(videoDetails.get(item.id)?.statistics?.viewCount ?? 0)));
    const dayMs = 24 * 60 * 60 * 1000;
    const courseTerms = /full course|complete course|tutorial|crash course|beginner|playlist/i;

    const ranked = relevantCandidates.map((candidate, index) => {
      const video = candidate.type === 'video' ? videoDetails.get(candidate.id) : undefined;
      const playlist = candidate.type === 'playlist' ? playlistDetails.get(candidate.id) : undefined;
      const viewCount = video?.statistics?.viewCount ? Number(video.statistics.viewCount) : undefined;
      const likeCount = video?.statistics?.likeCount ? Number(video.statistics.likeCount) : undefined;
      const ageDays = candidate.publishedAt ? Math.max(0, (Date.now() - Date.parse(candidate.publishedAt)) / dayMs) : undefined;
      const relevance = 1 - index / Math.max(1, relevantCandidates.length);
      const popularity = viewCount ? Math.log10(viewCount + 1) / Math.log10(maxViews + 1) : 0;
      const likeRatio = viewCount && likeCount ? Math.min(likeCount / viewCount / 0.05, 1) : 0;
      const recency = ageDays === undefined || Number.isNaN(ageDays) ? 0 : Math.exp(-ageDays / 1800);
      const learningTitle = courseTerms.test(candidate.title) ? 1 : 0;
      const playlistSize = playlist?.contentDetails?.itemCount ?? 0;
      const playlistCompleteness = candidate.type === 'playlist' ? Math.min(playlistSize / 20, 1) : 0;
      const score = relevance * 0.48 + learningTitle * 0.2 + popularity * 0.14 + likeRatio * 0.08 + recency * 0.05 + playlistCompleteness * 0.05;

      return {
        type: candidate.type,
        language: languageById.get(candidate.id) as 'English' | 'Hindi',
        title: candidate.title,
        channelTitle: candidate.channelTitle,
        publishedAt: candidate.publishedAt,
        thumbnailUrl: candidate.thumbnailUrl,
        watchUrl: candidate.watchUrl,
        ...(viewCount !== undefined ? { viewCount } : {}),
        ...(likeCount !== undefined ? { likeCount } : {}),
        ...(playlist?.contentDetails?.itemCount !== undefined ? { itemCount: playlist.contentDetails.itemCount } : {}),
        score,
      };
    }).sort((a, b) => b.score - a.score);
    return ranked.map(({ score, ...item }) => item);
  }

  private getCourseLanguage(
    candidate: Candidate,
    videoDetails: Map<string, VideoDetails>,
    playlistDetails: Map<string, PlaylistDetails>,
  ): 'English' | 'Hindi' | null {
    const text = `${candidate.title} ${candidate.description}`;
    if (/[\u0980-\u09FF]/u.test(text) || /\b(bangla|bengali)\b/i.test(text)) {
      return null;
    }

    const explicitLanguage = candidate.type === 'video'
      ? videoDetails.get(candidate.id)?.snippet?.defaultAudioLanguage ?? videoDetails.get(candidate.id)?.snippet?.defaultLanguage
      : playlistDetails.get(candidate.id)?.snippet?.defaultLanguage;

    if (explicitLanguage) {
      const code = explicitLanguage.toLowerCase().replace('_', '-');
      if (code === 'en' || code.startsWith('en-')) return 'English';
      if (code === 'hi' || code.startsWith('hi-')) return 'Hindi';
      return null;
    }

    const title = candidate.title;
    if (/\p{Script=Devanagari}/u.test(title) || /\b(hindi|hindi mein|in hindi|हिंदी)\b/i.test(title)) {
      return 'Hindi';
    }
    if (/\b(english|course|tutorial|learn|complete|beginner|lesson|full|masterclass)\b/i.test(title)) {
      return 'English';
    }
    return null;
  }
}

type CandidateGroups = { videos: Candidate[]; playlists: Candidate[] };
