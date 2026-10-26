import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from './schemas/user.schema';
import {
  UserProfile,
  UserProfileDocument,
} from './schemas/user-profile.schema';
import { UpdateUserProfileDto } from './dto/update-user-profile.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(UserProfile.name)
    private readonly userProfileModel: Model<UserProfileDocument>,
  ) {}

  findByEmail(email: string) {
    return this.userModel.findOne({ email }).exec();
  }

  findByGoogleId(googleId: string) {
    return this.userModel.findOne({ googleId }).exec();
  }

  create(email: string, passwordHash: string, consentGiven: boolean) {
    return this.userModel.create({
      email,
      passwordHash,
      consentGiven,
    });
  }

  createGoogleUser(email: string, googleId: string, consentGiven: boolean) {
    return this.userModel.create({
      email,
      googleId,
      consentGiven,
    });
  }

  // ── Master Profile Methods ──

  async getProfile(userId: string): Promise<UserProfileDocument> {
    // First, ensure the user exists
    await this.findById(userId);

    let profile = await this.userProfileModel.findOne({ userId }).exec();
    if (!profile) {
      // Auto-create empty profile if it doesn't exist yet
      profile = await this.userProfileModel.create({ userId });
    }
    return profile;
  }

  async updateProfile(
    userId: string,
    dto: UpdateUserProfileDto,
  ): Promise<UserProfileDocument> {
    const { _id, userId: _, __v, createdAt, updatedAt, email, ...cleanDto } =
      dto as any;
    const profile = await this.userProfileModel
      .findOneAndUpdate(
        { userId },
        { $set: cleanDto },
        { new: true, upsert: true },
      )
      .exec();
    return profile;
  }

  /**
   * Syncs basic info, skills, and target roles from an uploaded or saved resume into the Master Profile.
   */
  async syncFromParsedResume(
    userId: string,
    resumeId: string,
    parsedData: {
      name?: string;
      phone?: string;
      linkedin?: string;
      github?: string;
      links?: string[];
      skills?: string[];
      targetRole?: string;
    },
  ): Promise<UserProfileDocument> {
    const profile = await this.getProfile(userId);

    if (parsedData.name && !profile.name) {
      profile.name = parsedData.name;
    }
    if (parsedData.phone && !profile.phone) {
      profile.phone = parsedData.phone;
    }
    if (parsedData.linkedin && !profile.linkedin) {
      profile.linkedin = parsedData.linkedin;
    }
    if (parsedData.github && !profile.github) {
      profile.github = parsedData.github;
    }

    if (parsedData.links && parsedData.links.length > 0) {
      for (const link of parsedData.links) {
        if (link.includes('linkedin.com') && !profile.linkedin) {
          profile.linkedin = link;
        } else if (link.includes('github.com') && !profile.github) {
          profile.github = link;
        } else if (!profile.portfolio && !link.includes('linkedin') && !link.includes('github')) {
          profile.portfolio = link;
        }
      }
    }

    // Merge skills into Master Skills (set union)
    if (parsedData.skills && parsedData.skills.length > 0) {
      const merged = new Set([
        ...(profile.masterSkills || []),
        ...parsedData.skills,
      ]);
      profile.masterSkills = Array.from(merged);
    }

    // Append target role to preferredRoles if provided and not already present
    if (parsedData.targetRole && parsedData.targetRole.trim()) {
      const cleanRole = parsedData.targetRole.trim();
      const existing = profile.preferredRoles || [];
      const alreadyPresent = existing.some(
        (r) => r.toLowerCase() === cleanRole.toLowerCase(),
      );
      if (!alreadyPresent) {
        profile.preferredRoles = [...existing, cleanRole];
      }
    }

    if (!profile.primaryResumeId) {
      profile.primaryResumeId = resumeId;
    }

    return await profile.save();
  }

  async findById(userId: string): Promise<UserDocument> {
    const user = await this.userModel.findById(userId).exec();
    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }
    return user;
  }

  async findAll(): Promise<UserDocument[]> {
    return this.userModel.find().exec();
  }
}