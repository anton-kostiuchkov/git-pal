import { useSuspenseQuery } from "@tanstack/react-query";
import { GitMerge } from "lucide-react";

import commands from "~/commands";
import { IconWrapper } from "~/components/icon-wrapper";
import { CommandGroup, CommandItem } from "~/components/ui/command";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import type {
  MergeQueueEntry,
  MergeQueueEntryState,
  PullRequest,
  Repository,
} from "~/models";

import { Container } from "./Layout";
import { state, useCurrentPage } from "./state";
import { viewPullRequest } from "./utils";

type QueuedEntry = MergeQueueEntry & { pullRequest: PullRequest };

const MERGE_QUEUE_REFRESH_MS = 10_000;
const SECONDS_PER_MINUTE = 60;

const STATE_LABELS: Record<Exclude<MergeQueueEntryState, object>, string> = {
  AWAITING_CHECKS: "Awaiting checks",
  LOCKED: "Locked",
  MERGEABLE: "Mergeable",
  QUEUED: "Queued",
  UNMERGEABLE: "Unmergeable",
};

function stateLabel(value: MergeQueueEntryState) {
  if (typeof value === "object") return value.Other;

  return STATE_LABELS[value];
}

function useMergeQueueQuery(repository: Repository) {
  const params = {
    owner: repository.owner.login,
    repository: repository.name,
  };

  return useSuspenseQuery({
    queryKey: ["merge-queue", params.owner, params.repository],
    queryFn: async () => {
      const mergeQueue = await commands.findMergeQueue(params);
      const entries =
        mergeQueue?.entries?.nodes?.filter(
          (entry): entry is QueuedEntry => !!entry?.pullRequest,
        ) ?? [];

      // pull request actions (review, open on GitHub) look items up by id
      queueMicrotask(() => {
        entries.forEach(({ pullRequest }) => {
          state.setItem(pullRequest.id, { kind: "pr", data: pullRequest });
        });
      });

      return entries;
    },
    refetchInterval: MERGE_QUEUE_REFRESH_MS,
  });
}

function EmptyQueue() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <GitMerge />
        </EmptyMedia>
        <EmptyTitle>The merge queue is empty</EmptyTitle>
      </EmptyHeader>
    </Empty>
  );
}

function EntryItem({ entry }: { entry: QueuedEntry }) {
  const { pullRequest } = entry;
  const details = [`#${pullRequest.number}`, stateLabel(entry.state)];

  if (entry.estimatedTimeToMerge !== null) {
    const minutes = Math.ceil(entry.estimatedTimeToMerge / SECONDS_PER_MINUTE);
    details.push(`~${minutes} min`);
  }

  return (
    <Container>
      <IconWrapper>
        <span className="text-sm font-medium">{entry.position}</span>
      </IconWrapper>

      <div className="flex flex-col">
        <span>{pullRequest.title}</span>
        <span className="text-xs text-muted-foreground group-data-[selected=true]:text-primary-foreground/80">
          {details.join(" · ")}
        </span>
      </div>

      <img
        alt={pullRequest.author?.login}
        className="size-6 rounded-full"
        src={pullRequest.author?.avatarUrl}
      />
    </Container>
  );
}

function MergeQueue({ repository }: { repository: Repository }) {
  const { data: entries } = useMergeQueueQuery(repository);

  if (entries.length === 0) {
    return <EmptyQueue />;
  }

  return (
    <CommandGroup heading="Merge Queue">
      {entries.map((entry) => (
        <CommandItem
          key={entry.id}
          value={entry.pullRequest.id}
          keywords={[entry.pullRequest.title, String(entry.pullRequest.number)]}
          onSelect={() => viewPullRequest(entry.pullRequest)}
        >
          <EntryItem entry={entry} />
        </CommandItem>
      ))}
    </CommandGroup>
  );
}

export function RepositoryMergeQueuePage() {
  const { params } = useCurrentPage("repository-merge-queue");
  const item = state.getItem(params.id);

  if (item?.kind !== "repo") return null;

  return <MergeQueue repository={item.data} />;
}
