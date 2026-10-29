import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "cn";
import {
  formatDistanceToNowStrict,
  fromUnixTime,
  minutesToMilliseconds,
} from "date-fns";
import {
  Bell,
  BellOff,
  Brush,
  FileText,
  FolderOpen,
  HardDrive,
} from "lucide-react";
import { useEffect, useState } from "react";
import { proxy, useSnapshot } from "valtio";

import commands from "~/commands";
import {
  HARNESS_LABELS,
  HarnessLogo,
  useDefaultHarness,
} from "~/components/harness";
import { Spinner } from "~/components/spinner";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import { Progress } from "~/components/ui/progress";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import { useHarnessModelQuery } from "~/features/agent/data-loader";
import { useJobs } from "~/features/jobs";
import { HarnessSelect } from "~/features/settings/HarnessSelect";
import { useResolvedTemplateQuery } from "~/features/templates/data-loader";
import { templateManager } from "~/features/templates/store";
import type { RateLimit } from "~/models/api";
import { formatBytes } from "~/libs/utils";
import type { JobStatus } from "~/models/jobs";

import { useSavedReviewsQuery } from "./data-loader";
import { LEVEL_LABELS } from "./RiskBadge";
import { store, useCodeReviewSnapshot } from "./store";
import { reviewJobId } from "./utils";

const REFRESH_MS = minutesToMilliseconds(1);
const SIZE_KEY = ["worktrees-size"];
const ACTIVE_STATUSES: JobStatus[] = ["queued", "running"];
const BUILT_IN_TEMPLATE = "Built-in template";

// usage shown as a warning above it
const HIGH_USAGE_RATIO = 0.9;

const OPEN_FOLDER_LABEL = `Open in ${fileManagerName()}`;

const monitoring = proxy({
  enabled: globalThis.settings.monitorPullRequests,
  interval: globalThis.settings.monitorInterval,
});

commands.onSettingChanged((event) => {
  const value = event.payload.settingChanged;
  if ("monitorPullRequests" in value) {
    monitoring.enabled = value.monitorPullRequests;
  }

  if ("monitorInterval" in value) monitoring.interval = value.monitorInterval;
});

function fileManagerName() {
  if (navigator.userAgent.includes("Mac")) return "Finder";
  if (navigator.userAgent.includes("Windows")) return "Explorer";

  return "file manager";
}

function usageRatio(quota: RateLimit) {
  if (quota.limit === 0) return 0;

  return quota.used / quota.limit;
}

function StatusButton({
  className,
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button
      variant="ghost"
      size="xs"
      className={cn("h-6 px-1.5 font-normal text-muted-foreground", className)}
      {...props}
    />
  );
}

function HarnessItem() {
  const harness = useDefaultHarness();
  const { data: model } = useHarnessModelQuery();

  return (
    <Popover>
      <PopoverTrigger render={<StatusButton />}>
        <HarnessLogo harness={harness} />
        {HARNESS_LABELS[harness]}
        {model && <span>· {model}</span>}
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-auto">
        <HarnessSelect />
      </PopoverContent>
    </Popover>
  );
}

function TemplateItem() {
  const { selectedReview: review } = useCodeReviewSnapshot();
  const { data: template } = useResolvedTemplateQuery(
    review?.owner,
    review?.repository,
    review?.prNumber,
  );

  // `null` stands for the built-in instructions
  if (template === undefined) return null;

  return (
    <Tooltip>
      <TooltipTrigger
        render={<StatusButton onClick={() => templateManager.setOpen(true)} />}
      >
        <FileText />
        {template?.name ?? BUILT_IN_TEMPLATE}
        {template?.autoApprove && (
          <span>
            · auto-approve ≤ {LEVEL_LABELS[template.autoApproveMaxRisk]}
          </span>
        )}
      </TooltipTrigger>
      <TooltipContent>Manage review templates</TooltipContent>
    </Tooltip>
  );
}

function JobsItem() {
  const [open, setOpen] = useState(false);
  const { tasks } = useJobs();
  const { data: reviews = [] } = useSavedReviewsQuery();

  const running = reviews.filter((review) =>
    tasks.some(
      (t) =>
        t.jobId === reviewJobId(review) && ACTIVE_STATUSES.includes(t.status),
    ),
  );
  if (running.length === 0) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<StatusButton />}>
        <Spinner className="size-3" />
        {running.length} reviewing
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="gap-0 p-1">
        {running.map((review) => (
          <Button
            key={review.id}
            variant="ghost"
            size="sm"
            className="justify-start font-normal"
            onClick={() => {
              store.selectReview(review);
              setOpen(false);
            }}
          >
            <span className="truncate">{review.prTitle}</span>
            <span className="text-muted-foreground">#{review.prNumber}</span>
          </Button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function MonitoringItem() {
  const { enabled, interval } = useSnapshot(monitoring);
  const label = enabled
    ? `Checking review requests every ${interval}s`
    : "Review request checks off";

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <StatusButton
            aria-label={label}
            onClick={() =>
              commands.updateSetting({ monitorPullRequests: !enabled })
            }
          />
        }
      >
        {enabled ? <Bell /> : <BellOff />}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function RateLimitItem() {
  const { data } = useQuery({
    queryKey: ["rate-limits"],
    queryFn: commands.rateLimits,
    refetchInterval: REFRESH_MS,
  });
  if (!data) return null;

  const quotas = [
    { label: "GraphQL", quota: data.graphql },
    { label: "REST", quota: data.core },
  ];
  const highest = Math.max(...quotas.map(({ quota }) => usageRatio(quota)));
  const percent = Math.round(highest * 100);

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={cn(
              "flex items-center gap-1.5 px-1.5 text-muted-foreground",
              highest > HIGH_USAGE_RATIO && "text-warning",
            )}
          />
        }
      >
        API Quota {percent}%
        {/* filled with the text color, warning included */}
        <Progress
          value={percent}
          className="w-12 **:data-[slot=progress-indicator]:bg-current"
        />
      </TooltipTrigger>
      <TooltipContent className="flex flex-col">
        {quotas.map(({ label, quota }) => (
          <span key={label}>
            {label} {quota.remaining.toLocaleString()}/
            {quota.limit.toLocaleString()}, resets in{" "}
            {formatDistanceToNowStrict(fromUnixTime(quota.reset))}
          </span>
        ))}
      </TooltipContent>
    </Tooltip>
  );
}

function WorktreesItem() {
  const queryClient = useQueryClient();
  const { data: size } = useQuery({
    queryKey: SIZE_KEY,
    queryFn: commands.worktreesSize,
  });
  const cleanUp = useMutation({ mutationFn: commands.cleanUpWorktrees });

  useEffect(() => {
    const listener = commands.onWorktreesChanged(() =>
      queryClient.invalidateQueries({ queryKey: SIZE_KEY }),
    );

    return () => {
      listener.then((unsub) => unsub());
    };
  }, [queryClient]);

  if (size === undefined) return null;

  const cleanUpLabel = cleanUp.isError
    ? `Cleanup failed: ${cleanUp.error}`
    : "Remove worktrees of merged or closed pull requests";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<StatusButton aria-label="Disk used by review worktrees" />}
        >
          <HardDrive />
          {formatBytes(size)}
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="end" className="w-auto">
          <DropdownMenuItem onClick={() => commands.openRepositoriesDir()}>
            <FolderOpen />
            {OPEN_FOLDER_LABEL}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <StatusButton
              aria-label={cleanUpLabel}
              disabled={cleanUp.isPending}
              onClick={() => cleanUp.mutate()}
            />
          }
        >
          {cleanUp.isPending ? <Spinner className="size-3" /> : <Brush />}
        </TooltipTrigger>
        <TooltipContent>{cleanUpLabel}</TooltipContent>
      </Tooltip>
    </>
  );
}

export function StatusBar() {
  return (
    <footer className="flex h-7 shrink-0 items-center gap-1 px-2 pb-1 text-xs">
      <HarnessItem />
      <TemplateItem />
      <div className="flex-1" />
      <JobsItem />
      <MonitoringItem />
      <RateLimitItem />
      <WorktreesItem />
    </footer>
  );
}
