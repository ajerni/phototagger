import { FormEvent, useEffect, useMemo, useState } from "react";
import { Pencil, RotateCcw, Save, Search, Trash2, Plus } from "lucide-react";
import {
  analyzeTrip,
  askTrip,
  cancelJob,
  clearTripAnalysis,
  createTrip,
  deletePhoto,
  deleteTrip,
  exportTripMarkdown,
  exportTripZip,
  getJob,
  getLatestTripJob,
  getTrip,
  importPhotos,
  listTrips,
  retryJob,
  updatePhoto,
  updateTrip,
  updateTripMemory,
  type AnalyzeMode,
  type AnalysisJob,
  type AskResponse,
  type HealthResponse,
  type Photo,
  type PhotoImportResponse,
  type Trip,
  type TripDetail
} from "../api/client";
import { MemoryCompanion } from "../components/companion/MemoryCompanion";
import { MemoryMap } from "../components/map/MemoryMap";
import { PhotoMosaic } from "../components/photo/PhotoMosaic";
import { MemoryStory } from "../components/story/MemoryStory";
import { TripCover } from "../components/story/TripCover";
import { type ExploreView, ViewSwitcher } from "../components/story/ViewSwitcher";
import { type WorkspaceTab, WorkspaceTabs } from "../components/story/WorkspaceTabs";
import { MemoryTimeline } from "../components/timeline/MemoryTimeline";
import { UploadPanel } from "../components/upload/UploadPanel";

type TripWorkspaceProps = {
  health: HealthResponse | null;
  healthError: string | null;
};

type TripStage = "empty" | "needsPhotos" | "readyToDevelop" | "memoryReady";
type FilterKey = "favorites" | "mapped" | "noGps" | "analyzed" | "needsAnalysis" | "uncertain";

export function TripWorkspace({ health, healthError }: TripWorkspaceProps) {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [selectedTripId, setSelectedTripId] = useState<number | null>(null);
  const [selectedTripDetail, setSelectedTripDetail] = useState<TripDetail | null>(null);
  const [selectedPhotoId, setSelectedPhotoId] = useState<number | null>(null);
  const [spotlightPhotoId, setSpotlightPhotoId] = useState<number | null>(null);
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<WorkspaceTab>("read");
  const [activeView, setActiveView] = useState<ExploreView>("timeline");
  const [title, setTitle] = useState("First private trip");
  const [description, setDescription] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [askResponse, setAskResponse] = useState<AskResponse | null>(null);
  const [activeJob, setActiveJob] = useState<AnalysisJob | null>(null);
  const [isCreatingTrip, setIsCreatingTrip] = useState(false);
  const [importResult, setImportResult] = useState<PhotoImportResponse | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [renamingTripId, setRenamingTripId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [filters, setFilters] = useState<Record<FilterKey, boolean>>({
    favorites: false,
    mapped: false,
    noGps: false,
    analyzed: false,
    needsAnalysis: false,
    uncertain: false
  });
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");

  const selectedTrip = useMemo(
    () => selectedTripDetail ?? trips.find((trip) => trip.id === selectedTripId) ?? null,
    [selectedTripDetail, selectedTripId, trips]
  );
  const photos = selectedTripDetail?.photos ?? [];
  const selectedPhoto = useMemo(
    () => photos.find((photo) => photo.id === selectedPhotoId) ?? photos[0] ?? null,
    [photos, selectedPhotoId]
  );
  const coverPhoto =
    photos.find((photo) => photo.id === selectedTrip?.cover_photo_id) ??
    selectedPhoto ??
    photos.find((photo) => photo.analysis) ??
    photos[0] ??
    null;

  const filteredPhotos = useMemo(
    () =>
      filterPhotos({
        photos,
        trip: selectedTripDetail,
        query: searchQuery,
        filters,
        dateFrom,
        dateTo
      }),
    [photos, selectedTripDetail, searchQuery, filters, dateFrom, dateTo]
  );

  useEffect(() => {
    void refreshTrips();
  }, []);

  useEffect(() => {
    if (trips.length > 0) {
      setIsCreatingTrip(false);
    }
  }, [trips.length]);

  useEffect(() => {
    if (selectedTripId === null) {
      setSelectedTripDetail(null);
      return;
    }
    void refreshTripDetail(selectedTripId);
  }, [selectedTripId]);

  useEffect(() => {
    setEditTitle(selectedTrip?.title ?? "");
    setEditDescription(selectedTrip?.description ?? "");
  }, [selectedTrip?.id, selectedTrip?.title, selectedTrip?.description]);

  useEffect(() => {
    if (photos.length > 0 && !photos.some((photo) => photo.id === selectedPhotoId)) {
      setSelectedPhotoId(photos[0].id);
    }
  }, [photos, selectedPhotoId]);

  useEffect(() => {
    if (!activeJob || !isActiveJob(activeJob)) {
      return;
    }

    const timer = window.setInterval(() => {
      void pollJob(activeJob.id);
    }, 1200);

    return () => window.clearInterval(timer);
  }, [activeJob?.completed_steps, activeJob?.id, activeJob?.status]);

  const analysisRunning = activeJob ? isActiveJob(activeJob) : false;
  const hasAnalyzedPhotos = photos.some((photo) => photo.analysis !== null);
  const canAsk = Boolean(selectedTripDetail?.memory && hasAnalyzedPhotos);
  const analyzedCount = photos.filter((photo) => photo.analysis !== null).length;
  const missingAnalysisCount = photos.length - analyzedCount;
  const locatedCount = photos.filter(
    (photo) => photo.latitude !== null && photo.longitude !== null
  ).length;
  const filteredLocatedCount = filteredPhotos.filter(
    (photo) => photo.latitude !== null && photo.longitude !== null
  ).length;
  const tripStage = getTripStage(selectedTripId, photos.length, hasAnalyzedPhotos);

  async function runAction(
    action: () => Promise<void>,
    options: { trackBusy?: boolean; clearMessage?: boolean } = {}
  ) {
    const trackBusy = options.trackBusy ?? true;
    const clearMessage = options.clearMessage ?? true;
    if (trackBusy) {
      setBusy(true);
    }
    try {
      await action();
      if (clearMessage) {
        setMessage(null);
      }
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      if (trackBusy) {
        setBusy(false);
      }
    }
  }

  async function loadTrips() {
    const payload = await listTrips();
    setTrips(payload);
    setSelectedTripId((current) => current ?? payload[0]?.id ?? null);
  }

  async function refreshTrips() {
    await runAction(loadTrips, { trackBusy: false });
  }

  async function loadTripDetail(tripId: number) {
    const [payload, latestJob] = await Promise.all([
      getTrip(tripId),
      getLatestTripJob(tripId)
    ]);
    setSelectedTripDetail(payload);
    setTrips((current) =>
      current.map((trip) =>
        trip.id === payload.id
          ? {
              id: payload.id,
              title: payload.title,
              description: payload.description,
              cover_photo_id: payload.cover_photo_id,
              created_at: payload.created_at
            }
          : trip
      )
    );
    setActiveJob((current) => {
      if (latestJob) {
        return latestJob;
      }
      return current?.trip_id === tripId ? current : null;
    });
  }

  async function refreshTripDetail(tripId: number) {
    await runAction(() => loadTripDetail(tripId), { trackBusy: false });
  }

  async function handleCreateTrip(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim()) {
      return;
    }
    await runAction(async () => {
      const trip = await createTrip({
        title: title.trim(),
        description: description.trim() || null
      });
      setTrips((current) => [trip, ...current]);
      setSelectedTripId(trip.id);
      setSelectedTripDetail(null);
      setSelectedPhotoId(null);
      setSpotlightPhotoId(null);
      setAskResponse(null);
      setActiveJob(null);
      setIsCreatingTrip(false);
      setActiveWorkspaceTab("read");
      setActiveView("timeline");
      setTitle("");
      setDescription("");
    });
  }

  async function handleUpload(files: FileList | File[]) {
    if (selectedTripId === null || files.length === 0) {
      return;
    }
    await runAction(async () => {
      const result = await importPhotos(selectedTripId, files);
      setImportResult(result);
      await loadTripDetail(selectedTripId);
      setAskResponse(null);
    });
  }

  async function handleAnalyze(mode: AnalyzeMode = "all") {
    if (selectedTripId === null) {
      return;
    }
    await runAction(async () => {
      const job = await analyzeTrip(selectedTripId, mode);
      setActiveJob(job);
      setAskResponse(null);
      setActiveWorkspaceTab("read");
    });
  }

  async function handleCancelJob() {
    if (activeJob === null) {
      return;
    }
    await runAction(async () => {
      const job = await cancelJob(activeJob.id);
      setActiveJob(job);
    }, { trackBusy: false, clearMessage: false });
  }

  async function handleRetryJob() {
    if (activeJob === null) {
      return;
    }
    await runAction(async () => {
      const job = await retryJob(activeJob.id);
      setActiveJob(job);
      setAskResponse(null);
    });
  }

  async function handleAsk(question: string) {
    if (selectedTripId === null || !canAsk) {
      return;
    }
    await runAction(async () => {
      const response = await askTrip(selectedTripId, question);
      setAskResponse(response);
      await loadTripDetail(selectedTripId);
    });
  }

  async function handleUpdatePhoto(
    photoId: number,
    payload: {
      is_favorite?: boolean;
      user_memory_caption?: string | null;
      user_scene_summary?: string | null;
      user_mood?: string | null;
      user_note?: string | null;
    }
  ) {
    await runAction(async () => {
      await updatePhoto(photoId, payload);
      if (selectedTripId !== null) {
        await loadTripDetail(selectedTripId);
      }
    });
  }

  async function handleUpdateTripMemory(
    payload: {
      user_narrative_summary?: string | null;
      user_note?: string | null;
    }
  ) {
    if (selectedTripId === null) {
      return;
    }
    await runAction(async () => {
      const memory = await updateTripMemory(selectedTripId, payload);
      setSelectedTripDetail((current) =>
        current ? { ...current, memory } : current
      );
    });
  }

  async function handleSetCover(photoId: number) {
    if (selectedTripId === null) {
      return;
    }
    await runAction(async () => {
      await updateTrip(selectedTripId, { cover_photo_id: photoId });
      await loadTripDetail(selectedTripId);
    });
  }

  async function handleSaveTripDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedTripId === null || !editTitle.trim()) {
      return;
    }
    await runAction(async () => {
      await updateTrip(selectedTripId, {
        title: editTitle.trim(),
        description: editDescription.trim() || null
      });
      await loadTripDetail(selectedTripId);
    });
  }

  async function handleDeleteSelectedPhoto() {
    if (selectedPhoto === null) {
      return;
    }
    const ok = window.confirm(
      `Delete ${selectedPhoto.filename}? This removes the local image file and its memory.`
    );
    if (!ok) {
      return;
    }
    await runAction(async () => {
      await deletePhoto(selectedPhoto.id);
      if (selectedTripId !== null) {
        await loadTripDetail(selectedTripId);
      }
      setSelectedPhotoId(null);
      setAskResponse(null);
    });
  }

  async function handleClearAnalysis() {
    if (selectedTripId === null) {
      return;
    }
    const ok = window.confirm(
      "Clear generated memories, memory edits, and question history for this trip? Photos and favorites stay local."
    );
    if (!ok) {
      return;
    }
    await runAction(async () => {
      await clearTripAnalysis(selectedTripId);
      await loadTripDetail(selectedTripId);
      setAskResponse(null);
      setActiveJob(null);
    });
  }

  async function handleDeleteTrip() {
    if (selectedTripId === null || selectedTrip === null) {
      return;
    }
    const ok = window.confirm(
      `Delete "${selectedTrip.title}"? This removes its database records and uploaded local files.`
    );
    if (!ok) {
      return;
    }
    await runAction(async () => {
      await deleteTrip(selectedTripId);
      setSelectedTripDetail(null);
      setSelectedTripId(null);
      setSelectedPhotoId(null);
      setAskResponse(null);
      setActiveJob(null);
      await loadTrips();
    });
  }

  function startRename(trip: Trip) {
    setRenamingTripId(trip.id);
    setRenameValue(trip.title);
  }

  async function commitRename() {
    const id = renamingTripId;
    const trimmed = renameValue.trim();
    setRenamingTripId(null);
    if (id === null || !trimmed) return;
    await runAction(async () => {
      const updated = await updateTrip(id, { title: trimmed });
      setTrips((current) =>
        current.map((t) => (t.id === updated.id ? { ...t, title: updated.title } : t))
      );
      if (selectedTripDetail?.id === updated.id) {
        setSelectedTripDetail({ ...selectedTripDetail, title: updated.title });
      }
    });
  }

  async function handleDeleteTripById(id: number, tripTitle: string) {
    const ok = window.confirm(
      `Delete "${tripTitle}"? This removes its database records and uploaded local files.`
    );
    if (!ok) return;
    await runAction(async () => {
      await deleteTrip(id);
      if (selectedTripId === id) {
        setSelectedTripDetail(null);
        setSelectedTripId(null);
        setSelectedPhotoId(null);
        setAskResponse(null);
        setActiveJob(null);
      }
      await loadTrips();
    });
  }

  async function handleExportMarkdown() {
    if (selectedTripId === null) {
      return;
    }
    await runAction(async () => {
      const exported = await exportTripMarkdown(selectedTripId);
      downloadMarkdown(exported.filename, exported.content);
    });
  }

  async function handleExportZip() {
    if (selectedTripId === null) {
      return;
    }
    await runAction(async () => {
      const exported = await exportTripZip(selectedTripId);
      downloadBlob(exported.filename, exported.blob);
    });
  }

  async function pollJob(jobId: number) {
    await runAction(async () => {
      const previousJob = activeJob;
      const job = await getJob(jobId);
      const hasNewCompletedStep =
        job.status === "running" &&
        job.completed_steps > 0 &&
        (previousJob?.id !== job.id ||
          job.completed_steps !== previousJob.completed_steps);
      setActiveJob(job);
      if (hasNewCompletedStep) {
        await loadTripDetail(job.trip_id);
      }
      if (job.status === "completed") {
        await loadTripDetail(job.trip_id);
        setActiveWorkspaceTab("read");
      }
      if (job.status === "canceled") {
        setMessage("Analysis canceled");
      }
      if (job.status === "failed") {
        setMessage(job.error ?? "Analysis failed");
      }
    }, { trackBusy: false, clearMessage: false });
  }

  function handleSelectPhoto(photoId: number) {
    setSelectedPhotoId(photoId);
    setSpotlightPhotoId(photoId);
    window.setTimeout(() => {
      setSpotlightPhotoId((current) => (current === photoId ? null : current));
    }, 1400);
  }

  function handleOpenPhotoStory(photoId: number) {
    handleSelectPhoto(photoId);
    setActiveWorkspaceTab("read");
  }

  function handleShowOnMap(photoId: number) {
    handleSelectPhoto(photoId);
    setActiveWorkspaceTab("explore");
    setActiveView("map");
  }

  function handleSelectTrip(tripId: number) {
    setSelectedTripId(tripId);
    setAskResponse(null);
    setActiveJob(null);
    setActiveWorkspaceTab("read");
    setImportResult(null);
    setSearchQuery("");
    setFilters({
      favorites: false,
      mapped: false,
      noGps: false,
      analyzed: false,
      needsAnalysis: false,
      uncertain: false
    });
    setDateFrom("");
    setDateTo("");
    setActiveView("timeline");
  }

  const createTripOpen = trips.length === 0 || isCreatingTrip;
  const renderMemoryStory = (refineMode: boolean) => (
    <MemoryStory
      memory={selectedTripDetail?.memory ?? null}
      photos={photos}
      selectedPhoto={selectedPhoto}
      selectedPhotoId={selectedPhoto?.id ?? null}
      spotlightPhotoId={spotlightPhotoId}
      coverPhotoId={selectedTrip?.cover_photo_id ?? null}
      busy={busy}
      isRefining={refineMode}
      onSelectPhoto={handleSelectPhoto}
      onSelectEvidence={handleOpenPhotoStory}
      onShowOnMap={handleShowOnMap}
      onUpdatePhoto={handleUpdatePhoto}
      onUpdateTripMemory={handleUpdateTripMemory}
      onSetCover={handleSetCover}
      onRefineChange={(value) => setActiveWorkspaceTab(value ? "refine" : "read")}
    />
  );

  return (
    <section className="workspace story-workspace">
      <aside className="trip-rail story-rail">
        <div className="rail-intro">
          <span>Private library</span>
          <h2>Keep the trip close.</h2>
          <p>Choose a trip, import photos, and let the memory unfold locally.</p>
        </div>

        <details
          className="trip-create-panel"
          open={createTripOpen}
          onToggle={(event) => setIsCreatingTrip(event.currentTarget.open)}
        >
          <summary>
            <Plus size={15} aria-hidden="true" />
            <span>New trip</span>
          </summary>
          <form className="trip-form" onSubmit={handleCreateTrip}>
          <div className="panel-heading compact">
            <div>
              <span className="soft-kicker">New trip</span>
              <h2>Start a memory</h2>
            </div>
            <button
              className="primary-action"
              type="submit"
              disabled={busy || !title.trim()}
              title="Create trip"
            >
              <Plus size={16} aria-hidden="true" />
              <span>Create</span>
            </button>
          </div>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Trip title"
          />
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="A short note about this trip"
            rows={3}
          />
          </form>
        </details>

        <div className="trip-list-section">
          <div className="section-label">Trip library</div>
          <div className="trip-list">
            {trips.length === 0 ? (
              <p className="empty-copy">Create a trip to begin.</p>
            ) : (
              trips.map((trip) => (
                <div
                  key={trip.id}
                  className={`trip-list-item${trip.id === selectedTripId ? " selected" : ""}`}
                >
                  {renamingTripId === trip.id ? (
                    <input
                      autoFocus
                      className="trip-rename-input"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void commitRename();
                        if (e.key === "Escape") setRenamingTripId(null);
                      }}
                      onBlur={() => void commitRename()}
                    />
                  ) : (
                    <>
                      <button
                        className="trip-select-btn"
                        onClick={() => handleSelectTrip(trip.id)}
                        type="button"
                      >
                        <span className="trip-select-dot" aria-hidden="true" />
                        <span>
                          <strong>{trip.title}</strong>
                          <em>{trip.description || "Private photo memory"}</em>
                        </span>
                      </button>
                      <div className="trip-actions">
                        <button
                          type="button"
                          className="trip-action-btn"
                          title="Rename trip"
                          onClick={() => startRename(trip)}
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          type="button"
                          className="trip-action-btn trip-action-btn--delete"
                          title="Delete trip"
                          onClick={() => void handleDeleteTripById(trip.id, trip.title)}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        <UploadPanel
          disabled={selectedTripId === null || busy || analysisRunning}
          compact={tripStage === "memoryReady"}
          importResult={importResult}
          onUpload={handleUpload}
        />
      </aside>

      <main className="memory-reader">
        <TripCover
          trip={selectedTrip}
          coverPhoto={coverPhoto}
          photos={photos}
          selectedPhoto={selectedPhoto}
          photoCount={photos.length}
          locatedCount={locatedCount}
          analyzedCount={analyzedCount}
          missingAnalysisCount={missingAnalysisCount}
          backendReady={Boolean(health)}
          modelReady={Boolean(health?.model_available)}
          analyzeDisabled={
            selectedTripId === null ||
            busy ||
            analysisRunning ||
            photos.length === 0 ||
            !health?.model_available
          }
          job={activeJob}
          onAnalyze={handleAnalyze}
          onCancelJob={handleCancelJob}
          onRetryJob={handleRetryJob}
          onSetCover={handleSetCover}
          onExportMarkdown={handleExportMarkdown}
          onExportZip={handleExportZip}
        />

        <WorkspaceTabs
          activeTab={activeWorkspaceTab}
          onChange={setActiveWorkspaceTab}
        />

        <div className="memory-surface">
          {activeWorkspaceTab === "read" ? renderMemoryStory(false) : null}

          {activeWorkspaceTab === "explore" ? (
            <section className="explore-view">
              <SearchFilters
                query={searchQuery}
                filters={filters}
                dateFrom={dateFrom}
                dateTo={dateTo}
                resultCount={filteredPhotos.length}
                totalCount={photos.length}
                onQueryChange={setSearchQuery}
                onFilterChange={(key) =>
                  setFilters((current) => ({ ...current, [key]: !current[key] }))
                }
                onDateFromChange={setDateFrom}
                onDateToChange={setDateTo}
                onClear={() => {
                  setSearchQuery("");
                  setDateFrom("");
                  setDateTo("");
                  setFilters({
                    favorites: false,
                    mapped: false,
                    noGps: false,
                    analyzed: false,
                    needsAnalysis: false,
                    uncertain: false
                  });
                }}
              />

              <ViewSwitcher
                activeView={activeView}
                photoCount={photos.length}
                onChange={setActiveView}
              />

              {activeView === "timeline" ? (
                <MemoryTimeline
                  photos={filteredPhotos}
                  selectedPhotoId={selectedPhoto?.id ?? null}
                  spotlightPhotoId={spotlightPhotoId}
                  onSelectPhoto={handleOpenPhotoStory}
                />
              ) : null}

              {activeView === "map" ? (
                <section className="map-view">
                  <div className="section-heading">
                    <div>
                      <span className="soft-kicker">Map context</span>
                      <h2>Places from EXIF metadata</h2>
                    </div>
                  </div>
                  <div className="map-stat-row">
                    <span>
                      <strong>{filteredPhotos.length}</strong>
                      Photos
                    </span>
                    <span>
                      <strong>{filteredLocatedCount}</strong>
                      Mapped
                    </span>
                    <span>
                      <strong>{filteredPhotos.length - filteredLocatedCount}</strong>
                      Without GPS
                    </span>
                  </div>
                  <MemoryMap
                    photos={filteredPhotos}
                    selectedPhotoId={selectedPhoto?.id ?? null}
                    onSelectPhoto={handleSelectPhoto}
                    onInspectPhoto={handleOpenPhotoStory}
                  />
                </section>
              ) : null}

              {activeView === "photos" ? (
                <PhotoMosaic
                  photos={filteredPhotos}
                  selectedPhotoId={selectedPhoto?.id ?? null}
                  spotlightPhotoId={spotlightPhotoId}
                  coverPhotoId={selectedTrip?.cover_photo_id ?? null}
                  isRefining={false}
                  onSelectPhoto={handleOpenPhotoStory}
                  onUpdatePhoto={handleUpdatePhoto}
                />
              ) : null}
            </section>
          ) : null}

          {activeWorkspaceTab === "refine" ? (
            <section className="refine-view">
              {selectedTrip ? (
                <TripManagePanel
                  title={editTitle}
                  description={editDescription}
                  busy={busy}
                  hasAnalysis={hasAnalyzedPhotos || Boolean(selectedTripDetail?.memory)}
                  selectedPhoto={selectedPhoto}
                  onTitleChange={setEditTitle}
                  onDescriptionChange={setEditDescription}
                  onSave={handleSaveTripDetails}
                  onDeletePhoto={handleDeleteSelectedPhoto}
                  onClearAnalysis={handleClearAnalysis}
                  onDeleteTrip={handleDeleteTrip}
                />
              ) : null}
              {renderMemoryStory(true)}
            </section>
          ) : null}

          {activeWorkspaceTab === "ask" ? (
            <section className="ask-view">
              <MemoryCompanion
                health={health}
                healthError={healthError}
                askDisabled={!canAsk || busy || analysisRunning}
                job={activeJob}
                tripMemory={selectedTripDetail?.memory ?? null}
                askResponse={askResponse}
                questions={selectedTripDetail?.questions ?? []}
                photos={photos}
                exportDisabled={selectedTripId === null || busy}
                onAsk={handleAsk}
                onSelectEvidence={handleOpenPhotoStory}
                onExportMarkdown={handleExportMarkdown}
                onExportZip={handleExportZip}
              />
            </section>
          ) : null}
        </div>
      </main>

      {message ? <div className="toast">{message}</div> : null}
    </section>
  );
}

function isActiveJob(job: AnalysisJob): boolean {
  return (
    job.status === "queued" ||
    job.status === "running" ||
    job.status === "cancel_requested"
  );
}

function getTripStage(
  selectedTripId: number | null,
  photoCount: number,
  hasAnalyzedPhotos: boolean
): TripStage {
  if (selectedTripId === null) {
    return "empty";
  }
  if (photoCount === 0) {
    return "needsPhotos";
  }
  return hasAnalyzedPhotos ? "memoryReady" : "readyToDevelop";
}

function TripManagePanel({
  title,
  description,
  busy,
  hasAnalysis,
  selectedPhoto,
  onTitleChange,
  onDescriptionChange,
  onSave,
  onDeletePhoto,
  onClearAnalysis,
  onDeleteTrip
}: {
  title: string;
  description: string;
  busy: boolean;
  hasAnalysis: boolean;
  selectedPhoto: Photo | null;
  onTitleChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
  onDeletePhoto: () => void;
  onClearAnalysis: () => void;
  onDeleteTrip: () => void;
}) {
  return (
    <div className="trip-manage-panel">
      <span className="soft-kicker">Trip record</span>
      <form onSubmit={onSave}>
        <input
          value={title}
          onChange={(event) => onTitleChange(event.target.value)}
          placeholder="Trip title"
        />
        <textarea
          value={description}
          onChange={(event) => onDescriptionChange(event.target.value)}
          placeholder="Trip description"
          rows={3}
        />
        <button type="submit" disabled={busy || !title.trim()}>
          <Save size={14} aria-hidden="true" />
          <span>Save details</span>
        </button>
      </form>
      <div className="danger-actions">
        <button type="button" disabled={busy || !selectedPhoto} onClick={onDeletePhoto}>
          <Trash2 size={14} aria-hidden="true" />
          <span>Delete selected photo</span>
        </button>
        <button type="button" disabled={busy || !hasAnalysis} onClick={onClearAnalysis}>
          <RotateCcw size={14} aria-hidden="true" />
          <span>Clear analysis</span>
        </button>
        <button type="button" disabled={busy} onClick={onDeleteTrip}>
          <Trash2 size={14} aria-hidden="true" />
          <span>Delete trip and files</span>
        </button>
      </div>
    </div>
  );
}

function SearchFilters({
  query,
  filters,
  dateFrom,
  dateTo,
  resultCount,
  totalCount,
  onQueryChange,
  onFilterChange,
  onDateFromChange,
  onDateToChange,
  onClear
}: {
  query: string;
  filters: Record<FilterKey, boolean>;
  dateFrom: string;
  dateTo: string;
  resultCount: number;
  totalCount: number;
  onQueryChange: (value: string) => void;
  onFilterChange: (key: FilterKey) => void;
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
  onClear: () => void;
}) {
  const active = query.trim() !== "" || Object.values(filters).some(Boolean) || dateFrom || dateTo;
  const filterOptions: Array<{ key: FilterKey; label: string }> = [
    { key: "favorites", label: "Kept" },
    { key: "mapped", label: "Mapped" },
    { key: "noGps", label: "No GPS" },
    { key: "analyzed", label: "Remembered" },
    { key: "needsAnalysis", label: "Needs analysis" },
    { key: "uncertain", label: "Uncertain" }
  ];

  return (
    <section className={`memory-search ${active ? "active" : ""}`}>
      <label>
        <Search size={15} aria-hidden="true" />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search captions, notes, places, questions..."
        />
      </label>
      <div className="filter-row">
        {filterOptions.map((option) => (
          <button
            key={option.key}
            type="button"
            className={filters[option.key] ? "active" : ""}
            onClick={() => onFilterChange(option.key)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className="date-filter-row">
        <label>
          <span>From</span>
          <input
            type="date"
            value={dateFrom}
            onChange={(event) => onDateFromChange(event.target.value)}
          />
        </label>
        <label>
          <span>To</span>
          <input
            type="date"
            value={dateTo}
            onChange={(event) => onDateToChange(event.target.value)}
          />
        </label>
        <button type="button" disabled={!active} onClick={onClear}>
          Clear
        </button>
        <em>
          {resultCount} of {totalCount}
        </em>
      </div>
    </section>
  );
}

function filterPhotos({
  photos,
  trip,
  query,
  filters,
  dateFrom,
  dateTo
}: {
  photos: Photo[];
  trip: TripDetail | null;
  query: string;
  filters: Record<FilterKey, boolean>;
  dateFrom: string;
  dateTo: string;
}): Photo[] {
  const normalizedQuery = query.trim().toLowerCase();
  const tripMatches = normalizedQuery !== "" && trip !== null && tripText(trip).includes(normalizedQuery);
  const from = dateFrom ? new Date(`${dateFrom}T00:00:00`) : null;
  const to = dateTo ? new Date(`${dateTo}T23:59:59`) : null;

  return photos.filter((photo) => {
    const analysis = photo.analysis;
    const timestamp = new Date(photo.captured_at ?? photo.created_at);
    if (from && timestamp < from) {
      return false;
    }
    if (to && timestamp > to) {
      return false;
    }
    if (filters.favorites && !photo.is_favorite) {
      return false;
    }
    if (filters.mapped && (photo.latitude === null || photo.longitude === null)) {
      return false;
    }
    if (filters.noGps && photo.latitude !== null && photo.longitude !== null) {
      return false;
    }
    if (filters.analyzed && analysis === null) {
      return false;
    }
    if (filters.needsAnalysis && analysis !== null) {
      return false;
    }
    if (filters.uncertain && (analysis?.uncertainty_notes.length ?? 0) === 0) {
      return false;
    }
    return normalizedQuery === "" || tripMatches || photoText(photo).includes(normalizedQuery);
  });
}

function tripText(trip: TripDetail): string {
  return [
    trip.title,
    trip.description,
    trip.memory?.narrative_summary,
    trip.memory?.user_narrative_summary,
    trip.memory?.user_note,
    ...(trip.memory?.inferred_interests ?? []),
    ...(trip.memory?.recurring_themes ?? []),
    ...(trip.memory?.memorable_moments.flatMap((moment) => [
      moment.title,
      moment.description
    ]) ?? []),
    ...trip.questions.flatMap((item) => [item.question, item.answer])
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function photoText(photo: Photo): string {
  const analysis = photo.analysis;
  return [
    photo.filename,
    analysis?.memory_caption,
    analysis?.scene_summary,
    analysis?.place_type,
    analysis?.user_memory_caption,
    analysis?.user_scene_summary,
    analysis?.user_mood,
    analysis?.user_note,
    ...(analysis?.visible_activities ?? []),
    ...(analysis?.visible_objects ?? []),
    ...(analysis?.sensory_details ?? []),
    ...(analysis?.inferred_interest_signals ?? []),
    ...(analysis?.uncertainty_notes ?? [])
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function downloadMarkdown(filename: string, content: string) {
  const url = URL.createObjectURL(
    new Blob([content], { type: "text/markdown;charset=utf-8" })
  );
  downloadUrl(filename, url);
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  downloadUrl(filename, url);
}

function downloadUrl(filename: string, url: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
