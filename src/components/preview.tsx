"use client";
import {
  Eye,
  ImageIcon,
  Heart,
  MessageCircle,
  Send,
  MoreHorizontal,
  Play,
  Bookmark,
} from "lucide-react";
import { PlatformIcon } from "./platform";
import {
  captionFor,
  platformNames,
  platforms,
  type AccountInfo,
  type DraftInput,
  type MediaInfo,
  type Platform,
} from "@/lib/domain";
export default function Preview({
  draft,
  media,
  accounts,
  platform,
  onPlatform,
}: {
  draft: DraftInput;
  media: MediaInfo | null;
  accounts: AccountInfo[];
  platform: Platform;
  onPlatform: (value: Platform) => void;
}) {
  const account = accounts.find((a) => a.platform === platform),
    caption = captionFor(draft, platform),
    isVideo = media?.mime.startsWith("video/");
  const format = {
    instagram: isVideo ? "Reel" : "Feed",
    facebook: "Posting Page",
    youtube: draft.youtube.privacy,
    linkedin: "Posting profil",
  }[platform];
  return (
    <section className="preview-panel" aria-label="Preview konten">
      <div className="section-heading">
        <h2>
          <Eye size={16} />
          Preview konten
        </h2>
        <span className="quiet-tag">{format}</span>
      </div>
      <div className="preview-tabs" aria-label="Platform preview">
        {platforms.map((p) => (
          <button
            key={p}
            onClick={() => onPlatform(p)}
            aria-pressed={platform === p}
            title={platformNames[p]}
          >
            <PlatformIcon platform={p} size={16} />
            <span>{platformNames[p]}</span>
          </button>
        ))}
      </div>
      <div className={"social-post social-" + platform}>
        <div className="social-author">
          <div className="social-avatar">
            {account?.label.slice(0, 2).toUpperCase() || "RK"}
          </div>
          <div>
            <strong>{account?.label || "Akun tujuan"}</strong>
            <small>
              {account
                ? "Preview " + platformNames[platform]
                : "Belum terhubung"}
            </small>
          </div>
          <MoreHorizontal size={18} />
        </div>
        {platform === "linkedin" && caption && (
          <p className="post-caption before-media">{caption}</p>
        )}
        {media ? (
          <div className="actual-media">
            {isVideo ? (
              <video
                src={"/api/media/" + media.id}
                controls
                preload="metadata"
                playsInline
                aria-label={media.name}
              />
            ) : (
              <img src={"/api/media/" + media.id} alt={media.name} />
            )}
          </div>
        ) : (
          <div className="empty-preview">
            <div className="preview-orbit" aria-hidden="true">
              <ImageIcon size={30} />
            </div>
            <strong>
              Ruang untuk
              <br />
              ceritamu.
            </strong>
            <span>Tambahkan media untuk melihat preview.</span>
          </div>
        )}
        {platform === "instagram" && (
          <div className="social-actions" aria-hidden="true">
            <Heart size={19} />
            <MessageCircle size={19} />
            <Send size={18} />
            <Bookmark size={18} />
          </div>
        )}
        <div className="social-body">
          {platform === "youtube" && (
            <strong className="video-title">
              {draft.youtube.title || "Judul video YouTube"}
            </strong>
          )}
          {platform !== "linkedin" && (
            <p
              className={"post-caption " + (!caption ? "placeholder-text" : "")}
            >
              {caption || "Caption akan tampil di sini."}
            </p>
          )}
          {platform === "linkedin" && !caption && (
            <p className="placeholder-text">Caption akan tampil di sini.</p>
          )}
        </div>
      </div>
      <p className="preview-note">
        <Eye size={13} />
        Tampilan perkiraan, mengikuti format akhir platform.
      </p>
      {media?.mime.startsWith("video/") && (
        <span className="media-format-note">
          <Play size={12} />
          {media.width} × {media.height} · {Math.round(media.duration || 0)}{" "}
          detik
        </span>
      )}
    </section>
  );
}
