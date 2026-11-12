"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronRight,
  Clapperboard,
  CloudUpload,
  Copy,
  FileImage,
  Film,
  FolderOpen,
  ImageIcon,
  Layers,
  Link2,
  LoaderCircle,
  Plus,
  Save,
  Send,
  ShieldCheck,
  SquarePen,
  Trash2,
  TriangleAlert,
  UploadCloud,
  X,
  Monitor,
} from "lucide-react";
import { api, formatSize } from "@/lib/client";
import {
  captionFor,
  instagramPopupSessionKey,
  newDraft,
  platformNames,
  platforms,
  type AppState,
  type DraftInfo,
  type DraftInput,
  type Issue,
  type MediaInfo,
  type Platform,
} from "@/lib/domain";
import Preview from "./preview";
import Accounts from "./accounts";
import History from "./history";
import { PlatformIcon } from "./platform";
type View = "editor" | "drafts" | "media" | "history" | "accounts";
type Review = { reviewId: string | null; issues: Issue[]; draft: DraftInfo };
const nav = [
  { id: "editor", label: "Buat konten", icon: SquarePen },
  { id: "drafts", label: "Semua konten", icon: Layers },
  { id: "media", label: "Pustaka media", icon: ImageIcon },
  { id: "history", label: "Publikasi", icon: Send },
  { id: "accounts", label: "Akun terhubung", icon: Link2 },
] as const;
function inputOf(draft: DraftInfo): DraftInput {
  return {
    title: draft.title,
    caption: draft.caption,
    platforms: draft.platforms,
    variants: draft.variants,
    youtube: draft.youtube,
    mediaId: draft.mediaId,
  };
}
export default function Studio() {
  const [data, setData] = useState<AppState | null>(null),
    [view, setView] = useState<View>("editor"),
    [draft, setDraft] = useState<DraftInput>(newDraft),
    [draftId, setDraftId] = useState<string | null>(null),
    [version, setVersion] = useState(0),
    [previewPlatform, setPreviewPlatform] = useState<Platform>("instagram"),
    [captionMode, setCaptionMode] = useState<"common" | Platform>("common"),
    [busy, setBusy] = useState(""),
    [progress, setProgress] = useState<number | null>(null),
    [dragging, setDragging] = useState(false),
    [toast, setToast] = useState<{ message: string; error: boolean } | null>(
      null,
    ),
    [loadError, setLoadError] = useState(""),
    [review, setReview] = useState<Review | null>(null),
    [warningsAccepted, setWarningsAccepted] = useState(false),
    [pickMedia, setPickMedia] = useState(false);
  const saved = useRef(JSON.stringify(newDraft())),
    fileInput = useRef<HTMLInputElement>(null),
    dialog = useRef<HTMLDialogElement>(null),
    picker = useRef<HTMLDialogElement>(null),
    toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = JSON.stringify(draft) !== saved.current;
  const media = data?.media.find((m) => m.id === draft.mediaId) || null;
  const refresh = useCallback(async () => {
    const result = await api<AppState>("state");
    setData(result);
    setLoadError("");
  }, []);
  const notify = useCallback((message: string, error = false) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, error });
    toastTimer.current = setTimeout(() => setToast(null), 6500);
  }, []);
  useEffect(() => {
    const url = new URL(window.location.href);
    const platform = ["instagram", "youtube", "linkedin"].find((name) =>
      url.searchParams.has(`${name}_oauth`),
    );
    if (!platform) return;
    const result = url.searchParams.get(`${platform}_oauth`);
    if (result !== "connected" && result !== "error") return;
    const message = url.searchParams.get(`${platform}_message`);
    if (platform === "instagram" && typeof BroadcastChannel !== "undefined") {
      try {
        const channelName = sessionStorage.getItem(instagramPopupSessionKey);
        if (channelName) {
          sessionStorage.removeItem(instagramPopupSessionKey);
          const channel = new BroadcastChannel(channelName);
          channel.postMessage({ result, message });
          channel.close();
          window.close();
        }
      } catch {
        // The account page below also works when browser storage is unavailable.
      }
    }
    setView("accounts");
    if (message) notify(message.slice(0, 300), result === "error");
    url.searchParams.delete(`${platform}_oauth`);
    url.searchParams.delete(`${platform}_message`);
    window.history.replaceState(window.history.state, "", url);
  }, [notify]);
  useEffect(() => {
    let pending = false;
    let first = true;
    const poll = async () => {
      if (pending) return;
      pending = true;
      try {
        await refresh();
        first = false;
      } catch (error) {
        if (first) setLoadError((error as Error).message);
      } finally {
        pending = false;
      }
    };
    void poll();
    const timer = setInterval(poll, 5000);
    return () => {
      clearInterval(timer);
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, [refresh]);
  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
      }
    };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [dirty]);
  useEffect(() => {
    if (review && !dialog.current?.open) dialog.current?.showModal();
    else if (!review && dialog.current?.open) dialog.current?.close();
  }, [review]);
  useEffect(() => {
    if (pickMedia && !picker.current?.open) picker.current?.showModal();
    else if (!pickMedia && picker.current?.open) picker.current?.close();
  }, [pickMedia]);
  function patch(value: Partial<DraftInput>) {
    setDraft((current) => ({ ...current, ...value }));
    setReview(null);
  }
  function navigate(target: View) {
    if (
      view === "editor" &&
      target !== view &&
      dirty &&
      !confirm(
        "Ada perubahan yang belum disimpan. Tinggalkan editor? Perubahan tetap ada selama halaman ini terbuka.",
      )
    )
      return;
    setView(target);
  }
  function reset() {
    if (busy || progress !== null) return;
    if (
      dirty &&
      !confirm("Mulai konten baru? Perubahan yang belum disimpan akan hilang.")
    )
      return;
    const next = newDraft();
    setDraft(next);
    saved.current = JSON.stringify(next);
    setDraftId(null);
    setVersion(0);
    setView("editor");
    setCaptionMode("common");
    setReview(null);
  }
  function openDraft(item: DraftInfo, duplicate = false) {
    if (busy || progress !== null) return;
    if (
      dirty &&
      !confirm("Buka konten lain dan abaikan perubahan yang belum disimpan?")
    )
      return;
    const next = inputOf(item);
    if (duplicate) next.title += " (salinan)";
    setDraft(next);
    setDraftId(duplicate ? null : item.id);
    setVersion(duplicate ? 0 : item.version);
    saved.current = duplicate
      ? JSON.stringify(newDraft())
      : JSON.stringify(next);
    setView("editor");
    setCaptionMode("common");
    setReview(null);
    if (duplicate) notify("Salinan siap diedit. Simpan sebagai draft baru.");
  }
  async function save(quiet = false) {
    if (!draft.title.trim())
      throw new Error("Isi judul internal sebelum menyimpan.");
    const result = await api<DraftInfo>(
      draftId ? "drafts/" + draftId : "drafts",
      draftId ? "PUT" : "POST",
      draftId ? { expectedVersion: version, draft } : draft,
    );
    setDraftId(result.id);
    setVersion(result.version);
    saved.current = JSON.stringify(inputOf(result));
    setDraft(inputOf(result));
    await refresh();
    if (!quiet) notify("Draft tersimpan.");
    return result;
  }
  async function saveButton() {
    setBusy("save");
    try {
      await save();
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy("");
    }
  }
  async function reviewContent() {
    setBusy("review");
    try {
      const stored = await save(true);
      const result = await api<{ reviewId: string | null; issues: Issue[] }>(
        "review",
        "POST",
        { draftId: stored.id, version: stored.version },
      );
      setWarningsAccepted(false);
      setReview({ ...result, draft: stored });
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy("");
    }
  }
  async function publish() {
    if (!review?.reviewId) return;
    setBusy("publish");
    try {
      await api("publish", "POST", {
        reviewId: review.reviewId,
        acknowledgedWarnings: warningsAccepted,
      });
      setReview(null);
      setView("history");
      await refresh();
      notify("Publikasi diantrekan. Pantau hasil per platform di sini.");
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy("");
    }
  }
  async function upload(file: File) {
    if (busy || progress !== null) return;
    if (!["image/jpeg", "image/png", "video/mp4"].includes(file.type)) {
      notify("Gunakan gambar JPEG/PNG atau video MP4.", true);
      return;
    }
    if (file.size > (file.type === "video/mp4" ? 500 : 25) * 1024 * 1024) {
      notify("Maksimum gambar 25 MB dan video 500 MB.", true);
      return;
    }
    setProgress(0);
    try {
      const result = await new Promise<MediaInfo>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/media");
        xhr.setRequestHeader("Content-Type", file.type);
        xhr.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
        xhr.setRequestHeader("X-Ruang-Request", "1");
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable)
            setProgress(Math.min(99, Math.round((e.loaded / e.total) * 100)));
        };
        xhr.onload = () => {
          try {
            const body = JSON.parse(xhr.responseText);
            if (xhr.status >= 200 && xhr.status < 300) resolve(body);
            else reject(new Error(body.error || "Upload gagal."));
          } catch {
            reject(new Error("Server belum dapat menerima file."));
          }
        };
        xhr.onerror = () =>
          reject(new Error("Koneksi upload terputus. Coba kembali."));
        xhr.ontimeout = () =>
          reject(new Error("Upload terlalu lama. Coba kembali."));
        xhr.timeout = 15 * 60 * 1000;
        xhr.send(file);
      });
      patch({ mediaId: result.id });
      await refresh();
      notify("Media berhasil diunggah.");
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setProgress(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  async function removeDraft(item: DraftInfo) {
    if (!confirm("Hapus draft “" + item.title + "”?")) return;
    try {
      await api("drafts/" + item.id, "DELETE");
      await refresh();
      if (draftId === item.id) {
        saved.current = JSON.stringify(newDraft());
        setDraft(newDraft());
        setDraftId(null);
        setVersion(0);
      }
      notify("Draft dihapus.");
    } catch (e) {
      notify((e as Error).message, true);
    }
  }
  async function removeMedia(item: MediaInfo) {
    if (!confirm("Hapus media “" + item.name + "”?")) return;
    try {
      await api("media/" + item.id, "DELETE");
      await refresh();
      notify("Media dihapus.");
    } catch (e) {
      notify((e as Error).message, true);
    }
  }
  const active =
    data?.batches.reduce(
      (n, b) =>
        n +
        b.jobs.filter((j) =>
          ["QUEUED", "UPLOADING", "PROCESSING"].includes(j.state),
        ).length,
      0,
    ) || 0;
  const currentNav = nav.find((n) => n.id === view)!;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button
          className="brand"
          onClick={() => navigate("editor")}
          aria-label="Ruang Konten, buka editor"
        >
          <span className="brand-mark">
            <Clapperboard size={23} />
          </span>
          <span>
            Ruang Konten<small>Studio publikasi pribadi</small>
          </span>
        </button>
        <div className="sidebar-section-label">Ruang kerja</div>
        <nav aria-label="Navigasi utama">
          {nav.map((item) => (
            <button
              key={item.id}
              className={"nav-item " + (view === item.id ? "active" : "")}
              onClick={() => navigate(item.id)}
              aria-label={item.label}
              disabled={!!busy || progress !== null}
              title={item.label}
              aria-current={view === item.id ? "page" : undefined}
            >
              <item.icon size={18} />
              <span>{item.label}</span>
              {item.id === "drafts" && !!data?.drafts.length && (
                <small>{data.drafts.length}</small>
              )}
              {item.id === "history" && active > 0 && <small>{active}</small>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-icon">
            <Monitor size={17} />
          </div>
          <div>
            <strong>Ruang kerja lokal</strong>
            <small>Tanpa login · hanya perangkat ini</small>
          </div>
          <ShieldCheck size={15} />
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>Studio</span>
            <ChevronRight size={13} />
            <strong>{currentNav.label}</strong>
          </div>
          <div className="topbar-info">
            <span
              className={
                "worker-indicator " + (data?.workerOnline ? "online" : "")
              }
            >
              <i />
              {data?.workerOnline ? "Worker aktif" : "Worker belum aktif"}
            </span>
            <span className="topbar-divider" />
            <span className="storage-label">
              <CloudUpload size={14} />
              {data?.storage || "Menghubungkan…"}
            </span>
          </div>
        </header>
        <main className="workspace" id="main-content">
          {loadError ? (
            <div className="connection-error" role="alert">
              <TriangleAlert size={27} />
              <h1>Ruang kerja belum bisa dimuat</h1>
              <p>{loadError}</p>
              <button
                className="button"
                onClick={() => refresh().catch((e) => setLoadError(e.message))}
              >
                Coba kembali
              </button>
            </div>
          ) : !data ? (
            <div className="loading-page" role="status">
              <LoaderCircle size={26} className="spin" />
              Menyiapkan ruang kerja…
            </div>
          ) : (
            <>
              {view === "editor" && (
                <>
                  <div className="editor-heading">
                    <div>
                      <span className="eyebrow">Dari ide ke publikasi</span>
                      <h1>
                        {draftId ? "Lanjutkan ceritamu." : "Buat konten baru."}
                      </h1>
                      <p>
                        Satu ruang untuk menyiapkan, meninjau, dan membagikan.
                      </p>
                    </div>
                    <button
                      className="button ghost new-content"
                      onClick={reset}
                    >
                      <Plus size={16} />
                      Konten baru
                    </button>
                  </div>
                  <div className="workflow">
                    <div className="workflow-step current">
                      <span>1</span>
                      <strong>Siapkan konten</strong>
                      <small>Media & cerita</small>
                    </div>
                    <div className="workflow-connector" />
                    <div className="workflow-step">
                      <span>2</span>
                      <strong>Review</strong>
                      <small>Periksa setiap tujuan</small>
                    </div>
                    <div className="workflow-connector" />
                    <div className="workflow-step">
                      <span>3</span>
                      <strong>Publikasikan</strong>
                      <small>Pantau hasilnya</small>
                    </div>
                  </div>
                  <div className="editor-layout">
                    <div className="composer">
                      <div className="field-group">
                        <label htmlFor="internal-title">
                          Judul internal<span>Hanya untuk kamu</span>
                        </label>
                        <input
                          id="internal-title"
                          placeholder="Misalnya: Cerita di balik produk baru"
                          maxLength={150}
                          value={draft.title}
                          onChange={(e) => patch({ title: e.target.value })}
                          disabled={!!busy}
                        />
                      </div>
                      <section className="media-section">
                        <div className="section-heading">
                          <h2>Media konten</h2>
                          <button
                            className="text-button"
                            onClick={() => setPickMedia(true)}
                            disabled={!!busy || progress !== null}
                          >
                            <FolderOpen size={13} />
                            Dari pustaka
                          </button>
                        </div>
                        <input
                          ref={fileInput}
                          className="visually-hidden"
                          type="file"
                          tabIndex={-1}
                          accept="image/jpeg,image/png,video/mp4"
                          aria-label="Unggah gambar atau video"
                          onChange={(e) => {
                            if (e.target.files?.[0]) upload(e.target.files[0]);
                          }}
                        />
                        {media ? (
                          <div className="uploaded-file">
                            <div className="file-thumbnail">
                              {media.mime.startsWith("image/") ? (
                                <img src={"/api/media/" + media.id} alt="" />
                              ) : (
                                <Film size={23} />
                              )}
                            </div>
                            <div className="file-meta">
                              <strong>{media.name}</strong>
                              <span>
                                {formatSize(media.size)}
                                {media.duration
                                  ? " · " +
                                    Math.round(media.duration) +
                                    " detik"
                                  : ""}
                              </span>
                              <small>
                                <CheckCircle2 size={12} />
                                Siap direview
                              </small>
                            </div>
                            <button
                              className="icon-button"
                              aria-label="Lepaskan media dari konten"
                              disabled={!!busy}
                              onClick={() => patch({ mediaId: null })}
                            >
                              <X size={15} />
                            </button>
                          </div>
                        ) : (
                          <button
                            className={
                              "upload-zone " + (dragging ? "dragging" : "")
                            }
                            disabled={!!busy || progress !== null}
                            onClick={() => fileInput.current?.click()}
                            onDragOver={(e) => {
                              e.preventDefault();
                              setDragging(true);
                            }}
                            onDragLeave={() => setDragging(false)}
                            onDrop={(e) => {
                              e.preventDefault();
                              setDragging(false);
                              if (e.dataTransfer.files[0])
                                upload(e.dataTransfer.files[0]);
                            }}
                          >
                            <span className="upload-symbol">
                              {progress !== null ? (
                                <LoaderCircle size={25} className="spin" />
                              ) : (
                                <UploadCloud size={26} />
                              )}
                            </span>
                            <strong>
                              {progress !== null
                                ? progress === 99
                                  ? "Memeriksa media…"
                                  : `Mengunggah ${progress}%`
                                : "Tarik media ke sini"}
                            </strong>
                            <span>
                              {progress !== null ? (
                                "Tunggu sampai pemeriksaan selesai."
                              ) : (
                                <>
                                  atau <b>pilih dari perangkat</b>
                                </>
                              )}
                            </span>
                            <small>
                              JPEG, PNG hingga 25 MB · MP4 hingga 500 MB
                            </small>
                            {progress !== null && (
                              <span className="upload-progress">
                                <i style={{ width: progress + "%" }} />
                              </span>
                            )}
                          </button>
                        )}
                      </section>
                      <div className="caption-section">
                        <div className="section-heading">
                          <label htmlFor="caption">
                            {captionMode === "common"
                              ? "Caption umum"
                              : "Caption " + platformNames[captionMode]}
                          </label>
                          <select
                            className="caption-select"
                            value={captionMode}
                            onChange={(e) =>
                              setCaptionMode(
                                e.target.value as "common" | Platform,
                              )
                            }
                            aria-label="Pilih caption yang diedit"
                          >
                            <option value="common">Umum</option>
                            {platforms.map((p) => (
                              <option key={p} value={p}>
                                {platformNames[p]}
                              </option>
                            ))}
                          </select>
                        </div>
                        <textarea
                          id="caption"
                          placeholder="Apa cerita yang ingin kamu bagikan?"
                          rows={5}
                          value={
                            captionMode === "common"
                              ? draft.caption
                              : captionFor(draft, captionMode)
                          }
                          onChange={(e) =>
                            captionMode === "common"
                              ? patch({ caption: e.target.value })
                              : patch({
                                  variants: {
                                    ...draft.variants,
                                    [captionMode]: e.target.value,
                                  },
                                })
                          }
                          maxLength={63206}
                          disabled={!!busy}
                        />
                        <div className="field-footer">
                          <span>
                            {captionMode === "common" ? (
                              "Jadi caption awal untuk setiap platform."
                            ) : draft.variants[captionMode] !== undefined ? (
                              <button
                                className="text-button"
                                onClick={() => {
                                  const variants = { ...draft.variants };
                                  delete variants[captionMode];
                                  patch({ variants });
                                }}
                              >
                                Kembali ke caption umum
                              </button>
                            ) : (
                              "Mengikuti caption umum. Edit untuk membuat variasi."
                            )}
                          </span>
                          <span>
                            {(captionMode === "common"
                              ? draft.caption
                              : captionFor(draft, captionMode)
                            ).length.toLocaleString("id-ID")}{" "}
                            karakter
                          </span>
                        </div>
                      </div>
                      <section className="destinations">
                        <div className="section-heading">
                          <h2>Tujuan publikasi</h2>
                          <span className="count-tag">
                            {draft.platforms.length} dipilih
                          </span>
                        </div>
                        <div className="destination-grid">
                          {platforms.map((p) => {
                            const account = data.accounts.find(
                              (a) => a.platform === p,
                            );
                            return (
                              <label
                                className={
                                  "destination " +
                                  (draft.platforms.includes(p)
                                    ? "selected"
                                    : "")
                                }
                                key={p}
                              >
                                <input
                                  type="checkbox"
                                  checked={draft.platforms.includes(p)}
                                  onChange={(e) =>
                                    patch({
                                      platforms: e.target.checked
                                        ? [...draft.platforms, p]
                                        : draft.platforms.filter(
                                            (v) => v !== p,
                                          ),
                                    })
                                  }
                                  disabled={!!busy}
                                />
                                <span className={"platform-symbol " + p}>
                                  <PlatformIcon platform={p} size={18} />
                                </span>
                                <span className="destination-copy">
                                  <strong>{platformNames[p]}</strong>
                                  <small>
                                    {account?.label || "Belum terhubung"}
                                  </small>
                                </span>
                                <span className="destination-check">
                                  <Check size={12} />
                                </span>
                              </label>
                            );
                          })}
                        </div>
                        {draft.platforms.some(
                          (p) =>
                            !data.accounts.some(
                              (a) =>
                                a.platform === p && a.status === "CONNECTED",
                            ),
                        ) && (
                          <p className="inline-warning">
                            <Link2 size={13} />
                            Akun yang dipilih perlu dihubungkan sebelum publish.
                            <button
                              className="text-button"
                              onClick={() => navigate("accounts")}
                            >
                              Atur akun
                              <ArrowUpRight size={12} />
                            </button>
                          </p>
                        )}
                      </section>
                      {draft.platforms.includes("youtube") && (
                        <section className="youtube-settings">
                          <div className="section-heading">
                            <h2>
                              <PlatformIcon platform="youtube" size={17} />
                              Detail YouTube
                            </h2>
                            <span className="quiet-tag">Wajib diisi</span>
                          </div>
                          <label>
                            Judul video
                            <input
                              maxLength={100}
                              value={draft.youtube.title}
                              onChange={(e) =>
                                patch({
                                  youtube: {
                                    ...draft.youtube,
                                    title: e.target.value,
                                  },
                                })
                              }
                              placeholder="Judul yang tampil di YouTube"
                            />
                          </label>
                          <div className="two-fields">
                            <label>
                              Visibilitas
                              <select
                                value={draft.youtube.privacy}
                                onChange={(e) =>
                                  patch({
                                    youtube: {
                                      ...draft.youtube,
                                      privacy: e.target
                                        .value as DraftInput["youtube"]["privacy"],
                                    },
                                  })
                                }
                              >
                                <option value="private">Private</option>
                                <option value="unlisted">Unlisted</option>
                                <option value="public">Public</option>
                              </select>
                            </label>
                            <label>
                              Kategori
                              <select
                                value={draft.youtube.categoryId}
                                onChange={(e) =>
                                  patch({
                                    youtube: {
                                      ...draft.youtube,
                                      categoryId: e.target.value,
                                    },
                                  })
                                }
                              >
                                <option value="22">People & Blogs</option>
                                <option value="27">Education</option>
                                <option value="28">Science & Technology</option>
                                <option value="24">Entertainment</option>
                                <option value="26">Howto & Style</option>
                                <option value="10">Music</option>
                                <option value="20">Gaming</option>
                              </select>
                            </label>
                          </div>
                          <label>
                            Dibuat khusus untuk anak-anak?
                            <select
                              value={draft.youtube.madeForKids}
                              onChange={(e) =>
                                patch({
                                  youtube: {
                                    ...draft.youtube,
                                    madeForKids: e.target.value as
                                      | "yes"
                                      | "no"
                                      | "",
                                  },
                                })
                              }
                            >
                              <option value="">Pilih audiens</option>
                              <option value="no">
                                Tidak, bukan khusus anak-anak
                              </option>
                              <option value="yes">Ya, khusus anak-anak</option>
                            </select>
                          </label>
                          <label>
                            Konten sintetis/diubah yang tampak nyata?
                            <select
                              value={draft.youtube.synthetic}
                              onChange={(e) =>
                                patch({
                                  youtube: {
                                    ...draft.youtube,
                                    synthetic: e.target.value as
                                      | "yes"
                                      | "no"
                                      | "",
                                  },
                                })
                              }
                            >
                              <option value="">Pilih deklarasi</option>
                              <option value="no">Tidak</option>
                              <option value="yes">Ya</option>
                            </select>
                          </label>
                        </section>
                      )}
                    </div>
                    <Preview
                      draft={draft}
                      media={media}
                      accounts={data.accounts}
                      platform={previewPlatform}
                      onPlatform={setPreviewPlatform}
                    />
                  </div>
                  <footer className="editor-footer">
                    <span className="save-state">
                      {dirty ? (
                        <>
                          <span className="unsaved-dot" />
                          Perubahan belum disimpan
                        </>
                      ) : draftId ? (
                        <>
                          <CheckCircle2 size={14} />
                          Draft tersimpan
                        </>
                      ) : (
                        <>
                          <ShieldCheck size={14} />
                          Upload tidak otomatis memublikasikan
                        </>
                      )}
                    </span>
                    <div className="footer-actions">
                      <button
                        className="button"
                        onClick={saveButton}
                        disabled={!!busy || progress !== null}
                      >
                        {busy === "save" ? (
                          <LoaderCircle size={15} className="spin" />
                        ) : (
                          <Save size={15} />
                        )}
                        Simpan draft
                      </button>
                      <button
                        className="button primary"
                        onClick={reviewContent}
                        disabled={
                          !!busy || progress !== null || !draft.platforms.length
                        }
                      >
                        {busy === "review" ? (
                          <LoaderCircle size={15} className="spin" />
                        ) : null}
                        Review konten
                        <ArrowRight size={16} />
                      </button>
                    </div>
                  </footer>
                </>
              )}
              {view === "drafts" && (
                <>
                  <div className="page-intro with-action">
                    <div>
                      <span className="eyebrow">Koleksi cerita</span>
                      <h1>Semua konten.</h1>
                      <p>
                        Draft tersimpan dan konten yang pernah kamu siapkan.
                      </p>
                    </div>
                    <button className="button primary" onClick={reset}>
                      <Plus size={16} />
                      Buat konten
                    </button>
                  </div>
                  {!data.drafts.length ? (
                    <div className="empty-state">
                      <Layers size={30} />
                      <h2>Ceritamu dimulai di sini</h2>
                      <p>
                        Buat draft pertamamu, lalu simpan untuk dilanjutkan
                        kapan saja.
                      </p>
                      <button className="button" onClick={reset}>
                        Buat konten pertama
                        <ArrowRight size={15} />
                      </button>
                    </div>
                  ) : (
                    <div className="draft-grid">
                      {data.drafts.map((item) => (
                        <article className="draft-card" key={item.id}>
                          <button
                            className="draft-open"
                            onClick={() => openDraft(item)}
                          >
                            <div className="draft-cover">
                              {item.media?.mime.startsWith("image/") ? (
                                <img
                                  src={"/api/media/" + item.media.id}
                                  alt=""
                                />
                              ) : item.media ? (
                                <Film size={30} />
                              ) : (
                                <SquarePen size={30} />
                              )}
                              <span className="quiet-tag">
                                Draft · v{item.version}
                              </span>
                            </div>
                            <div className="draft-card-copy">
                              <h2>{item.title}</h2>
                              <p>{item.caption || "Belum ada caption"}</p>
                              <div>
                                {item.platforms.map((p) => (
                                  <PlatformIcon
                                    platform={p}
                                    size={14}
                                    key={p}
                                  />
                                ))}
                                <span>
                                  {new Date(item.updatedAt).toLocaleDateString(
                                    "id-ID",
                                    { day: "numeric", month: "short" },
                                  )}
                                </span>
                              </div>
                            </div>
                          </button>
                          <div className="draft-card-actions">
                            <button
                              className="text-button"
                              onClick={() => openDraft(item, true)}
                            >
                              <Copy size={13} />
                              Duplikat
                            </button>
                            <button
                              className="icon-button"
                              aria-label={"Hapus " + item.title}
                              onClick={() => removeDraft(item)}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </>
              )}
              {view === "media" && (
                <>
                  <div className="page-intro">
                    <span className="eyebrow">Bahan cerita</span>
                    <h1>Pustaka media.</h1>
                    <p>File yang sudah kamu unggah, siap dipakai lagi.</p>
                  </div>
                  {!data.media.length ? (
                    <div className="empty-state">
                      <FileImage size={30} />
                      <h2>Belum ada media</h2>
                      <p>Unggah gambar atau video dari editor konten.</p>
                      <button
                        className="button"
                        onClick={() => navigate("editor")}
                      >
                        Buka editor
                        <ArrowRight size={15} />
                      </button>
                    </div>
                  ) : (
                    <div className="media-grid">
                      {data.media.map((item) => (
                        <article className="media-card" key={item.id}>
                          <div className="media-card-preview">
                            {item.mime.startsWith("image/") ? (
                              <img
                                src={"/api/media/" + item.id}
                                alt={item.name}
                              />
                            ) : (
                              <video
                                src={"/api/media/" + item.id}
                                controls
                                preload="metadata"
                              />
                            )}
                          </div>
                          <div className="media-card-copy">
                            <strong>{item.name}</strong>
                            <span>
                              {formatSize(item.size)} · {item.width} ×{" "}
                              {item.height}
                            </span>
                            <div>
                              <button
                                className="text-button"
                                onClick={() => {
                                  patch({ mediaId: item.id });
                                  setView("editor");
                                  notify(
                                    "Media dipilih untuk konten saat ini.",
                                  );
                                }}
                              >
                                Gunakan
                                <ArrowRight size={13} />
                              </button>
                              <button
                                className="icon-button"
                                aria-label={"Hapus " + item.name}
                                onClick={() => removeMedia(item)}
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </>
              )}
              {view === "history" && (
                <History
                  batches={data.batches}
                  onRefresh={refresh}
                  notify={notify}
                />
              )}
              {view === "accounts" && (
                <Accounts
                  accounts={data.accounts}
                  onChange={refresh}
                  notify={notify}
                />
              )}
            </>
          )}
        </main>
        <div className="workspace-bottom">
          <span>Ruang Konten</span>
          <span>Dibuat untuk ceritamu.</span>
        </div>
      </div>
      {toast && (
        <div
          className={"toast " + (toast.error ? "toast-error" : "")}
          role={toast.error ? "alert" : "status"}
        >
          {toast.error ? (
            <TriangleAlert size={17} />
          ) : (
            <CheckCircle2 size={17} />
          )}
          <span>{toast.message}</span>
          <button
            className="icon-button"
            aria-label="Tutup notifikasi"
            onClick={() => setToast(null)}
          >
            <X size={14} />
          </button>
        </div>
      )}
      <dialog
        ref={dialog}
        className="review-dialog"
        onCancel={() => setReview(null)}
        onClose={() => setReview(null)}
      >
        {review && (
          <>
            <div className="dialog-heading">
              <div>
                <span className="eyebrow">Langkah terakhir</span>
                <h2>Review sebelum terbit.</h2>
              </div>
              <button
                className="icon-button"
                aria-label="Tutup review"
                onClick={() => setReview(null)}
                disabled={busy === "publish"}
              >
                <X size={20} />
              </button>
            </div>
            <p className="dialog-description">
              {review.draft.title} · {review.draft.platforms.length} tujuan ·
              Publikasi sekarang
            </p>
            {review.draft.media && (
              <div className="review-media">
                <Film size={16} />
                <span>{review.draft.media.name}</span>
                <small>{formatSize(review.draft.media.size)}</small>
              </div>
            )}
            <div className="review-targets">
              {review.draft.platforms.map((p) => {
                const account = data?.accounts.find((a) => a.platform === p);
                const issues = review.issues.filter((i) => i.platform === p);
                return (
                  <article className="review-target" key={p}>
                    <div className="review-target-head">
                      <PlatformIcon platform={p} />
                      <div>
                        <strong>{platformNames[p]}</strong>
                        <small>{account?.label || "Belum terhubung"}</small>
                      </div>
                      <span className="quiet-tag">
                        {p === "youtube"
                          ? review.draft.youtube.privacy
                          : "Public"}
                      </span>
                    </div>
                    {p === "youtube" && (
                      <strong className="review-video-title">
                        {review.draft.youtube.title || "Judul belum diisi"}
                      </strong>
                    )}
                    <p className="review-caption">
                      {captionFor(review.draft, p) || "Tanpa caption"}
                    </p>
                    {issues.map((issue, index) => (
                      <p
                        className={"review-issue " + issue.severity}
                        key={index}
                      >
                        <TriangleAlert size={13} />
                        {issue.message}
                      </p>
                    ))}
                  </article>
                );
              })}
            </div>
            {review.issues.some((i) => i.severity === "warning") && (
              <label className="warning-ack">
                <input
                  type="checkbox"
                  checked={warningsAccepted}
                  onChange={(e) => setWarningsAccepted(e.target.checked)}
                />
                Saya sudah membaca peringatan dan ingin melanjutkan.
              </label>
            )}
            {review.issues.some((i) => i.severity === "error") && (
              <p className="review-blocker" role="alert">
                Perbaiki bagian yang ditandai sebelum publikasi. Draft tetap
                tersimpan.
              </p>
            )}
            <div className="dialog-actions">
              <button
                className="button"
                onClick={() => setReview(null)}
                disabled={busy === "publish"}
              >
                Kembali edit
              </button>
              <button
                className="button primary"
                onClick={publish}
                disabled={
                  !!busy ||
                  !review.reviewId ||
                  (review.issues.some((i) => i.severity === "warning") &&
                    !warningsAccepted)
                }
              >
                {busy === "publish" ? (
                  <LoaderCircle size={15} className="spin" />
                ) : (
                  <Send size={15} />
                )}
                Publikasikan ke {review.draft.platforms.length} tujuan
              </button>
            </div>
            <p className="confirm-note">
              Setelah dikonfirmasi, konten dapat terlihat oleh audiens platform.
            </p>
          </>
        )}
      </dialog>
      <dialog
        ref={picker}
        className="media-picker"
        onCancel={() => setPickMedia(false)}
        onClose={() => setPickMedia(false)}
      >
        <div className="dialog-heading">
          <h2>Pilih dari pustaka</h2>
          <button
            className="icon-button"
            aria-label="Tutup pustaka"
            onClick={() => setPickMedia(false)}
          >
            <X size={20} />
          </button>
        </div>
        {!data?.media.length ? (
          <div className="empty-state">
            <FolderOpen size={26} />
            <p>Unggah media pertama dari editor.</p>
          </div>
        ) : (
          <div className="picker-grid">
            {data.media.map((item) => (
              <button
                key={item.id}
                className="picker-item"
                onClick={() => {
                  patch({ mediaId: item.id });
                  setPickMedia(false);
                }}
              >
                {item.mime.startsWith("image/") ? (
                  <img src={"/api/media/" + item.id} alt="" />
                ) : (
                  <Film size={25} />
                )}
                <span>{item.name}</span>
              </button>
            ))}
          </div>
        )}
      </dialog>
    </div>
  );
}
