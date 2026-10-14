import { useEffect } from "react";
import { cancelJob, createJob, fetchJobs, JOBS_STREAM_URL, type Job } from "./api";
import { refreshLibrary } from "./library";
import { createStore, useStore } from "./store";

type JobsState = { jobs: Job[]; connected: boolean };

export const jobsStore = createStore<JobsState>({ jobs: [], connected: false });

type JobEvent = { job: Job; previous: Job | undefined };
const finishListeners = new Set<(e: JobEvent) => void>();

/** Called once per job when it transitions into done/failed. */
export function onJobFinished(listener: (e: JobEvent) => void) {
  finishListeners.add(listener);
  return () => {
    finishListeners.delete(listener);
  };
}

let source: EventSource | null = null;
let subscribers = 0;

/** Pin relative retry countdowns to this browser's clock. */
const withRetryAt = (job: Job): Job => ({
  ...job,
  retryAt: job.retryIn != null ? Date.now() / 1000 + job.retryIn : null,
});

function applySnapshot(raw: Job[]) {
  const next = raw.map(withRetryAt);
  const prevById = new Map(jobsStore.get().jobs.map((j) => [j.id, j]));
  jobsStore.set({ jobs: next, connected: true });

  let libraryChanged = false;
  for (const job of next) {
    const previous = prevById.get(job.id);
    const finishedNow =
      (job.state === "done" || job.state === "failed") && previous && previous.state !== job.state;
    if (finishedNow) {
      if (job.state === "done") libraryChanged = true;
      finishListeners.forEach((l) => l({ job, previous }));
    }
  }
  if (libraryChanged) refreshLibrary();
}

function connect() {
  // Show the list right away (e.g. after a refresh) instead of waiting on the stream
  fetchJobs()
    .then((jobs) => {
      if (source && !jobsStore.get().connected) applySnapshot(jobs);
    })
    .catch(() => {});
  source = new EventSource(JOBS_STREAM_URL);
  source.onmessage = (e) => applySnapshot(JSON.parse(e.data));
  // EventSource reconnects on its own; just reflect the state.
  source.onerror = () => jobsStore.set((s) => ({ ...s, connected: false }));
}

/** Live job list over server-sent events; one shared connection for all subscribers. */
export function useJobs() {
  const state = useStore(jobsStore);
  useEffect(() => {
    if (subscribers++ === 0) connect();
    return () => {
      if (--subscribers === 0) {
        source?.close();
        source = null;
      }
    };
  }, []);
  return state;
}

export async function submitJob(url: string) {
  const result = await createJob(url);
  if (result.job) {
    const job = withRetryAt(result.job);
    // Show the card right away; the stream will take over from here.
    jobsStore.set((s) => ({ ...s, jobs: [job, ...s.jobs.filter((j) => j.id !== job.id)] }));
  }
  return result;
}

export async function removeJob(id: string) {
  const job = jobsStore.get().jobs.find((j) => j.id === id);
  if (job && job.state !== "queued" && job.state !== "running") {
    jobsStore.set((s) => ({ ...s, jobs: s.jobs.filter((j) => j.id !== id) }));
  }
  await cancelJob(id);
}
