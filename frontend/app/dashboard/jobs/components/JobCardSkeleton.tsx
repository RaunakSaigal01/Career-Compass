export default function JobCardSkeleton() {
  return (
    <div className="bg-white border border-zinc-200 rounded-lg p-5 animate-pulse shadow-xs">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div className="flex-1 space-y-3">
          <div className="flex items-center gap-2.5">
            <div className="h-5 bg-zinc-200 rounded w-1/3"></div>
            <div className="h-4 bg-zinc-200 rounded w-16"></div>
          </div>
          <div className="h-4 bg-zinc-100 rounded w-1/4"></div>
          <div className="h-3 bg-zinc-100 rounded w-1/2"></div>
          <div className="flex gap-2 pt-1">
            <div className="h-5 bg-zinc-100 rounded w-14"></div>
            <div className="h-5 bg-zinc-100 rounded w-16"></div>
            <div className="h-5 bg-zinc-100 rounded w-14"></div>
          </div>
        </div>
        <div className="w-28 h-8 bg-zinc-200 rounded-md"></div>
      </div>
    </div>
  );
}
