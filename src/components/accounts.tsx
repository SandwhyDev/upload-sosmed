"use client";
import { useState } from "react";
import {
  Check,
  ExternalLink,
  KeyRound,
  Link2,
  LoaderCircle,
  Unplug,
  ShieldCheck,
} from "lucide-react";
import { api } from "@/lib/client";
import {
  platforms,
  platformNames,
  instagramPopupSessionKey,
  linkedinOAuthCallbackPath,
  youtubeOAuthCallbackPath,
  type AccountInfo,
  type MetaAccountChoice,
  type Platform,
} from "@/lib/domain";
import { PlatformIcon } from "./platform";
const guides: Record<
  Platform,
  { label: string; placeholder: string; help: string; url: string }
> = {
  instagram: {
    label: "Instagram user ID",
    placeholder: "178414…",
    help: "Tempel token Instagram atau Facebook. Akun Business/Creator dan jalur token dideteksi otomatis.",
    url: "https://developers.facebook.com/docs/instagram-platform/",
  },
  facebook: {
    label: "Facebook Page ID",
    placeholder: "123456789…",
    help: "Tempel Page access token atau user token dengan akses Page. Publikasi ke profil pribadi tidak didukung.",
    url: "https://developers.facebook.com/docs/pages-api/",
  },
  youtube: {
    label: "YouTube channel ID",
    placeholder: "UC…",
    help: "Scope youtube.upload untuk upload; youtube.readonly untuk pemeriksaan identitas dan status.",
    url: "https://developers.google.com/youtube/v3/getting-started",
  },
  linkedin: {
    label: "Author URN",
    placeholder: "urn:li:person:…",
    help: "w_member_social untuk profil atau w_organization_social untuk organisasi. Profil perlu openid/profile untuk cek identitas.",
    url: "https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api",
  },
};
export default function Accounts({
  accounts,
  onChange,
  notify,
}: {
  accounts: AccountInfo[];
  onChange: () => Promise<void>;
  notify: (message: string, error?: boolean) => void;
}) {
  return (
    <div className="accounts-page">
      <div className="page-intro">
        <span className="eyebrow">Koneksi platform</span>
        <h1>Akun terhubung.</h1>
        <p>
          Tempel token Instagram atau Facebook, lalu pilih akun yang terdeteksi.
        </p>
      </div>
      <div className="account-security">
        <ShieldCheck size={19} />
        <div>
          <strong>Token tetap di server</strong>
          <p>
            Kredensial disimpan terenkripsi. Cek koneksi tidak membuat posting.
          </p>
        </div>
      </div>
      <div className="account-grid">
        {platforms.map((p) => (
          <AccountCard
            key={p}
            platform={p}
            account={accounts.find((a) => a.platform === p)}
            onChange={onChange}
            notify={notify}
          />
        ))}
      </div>
    </div>
  );
}
function AccountCard({
  platform,
  account,
  onChange,
  notify,
}: {
  platform: Platform;
  account?: AccountInfo;
  onChange: () => Promise<void>;
  notify: (message: string, error?: boolean) => void;
}) {
  const [editing, setEditing] = useState(!account),
    [label, setLabel] = useState(account?.label || ""),
    [externalId, setId] = useState(account?.externalId || ""),
    [token, setToken] = useState(""),
    [choices, setChoices] = useState<MetaAccountChoice[]>([]),
    [selectedId, setSelectedId] = useState(""),
    [manualYoutube, setManualYoutube] = useState(false),
    [manualInstagram, setManualInstagram] = useState(false),
    [manualLinkedIn, setManualLinkedIn] = useState(false),
    [busy, setBusy] = useState("");
  const guide = guides[platform];
  const isMeta = platform === "instagram" || platform === "facebook";
  const needsManualToken =
    !account || account.loginType === "google" || account.loginType === "linkedin";
  async function connectGoogle(form: HTMLFormElement) {
    const fields = new FormData(form);
    setBusy("oauth");
    try {
      const result = await api<{ authorizationUrl: string }>(
        "accounts/youtube/oauth",
        "POST",
        {
          clientId: fields.get("clientId"),
          clientSecret: fields.get("clientSecret"),
        },
      );
      form.reset();
      window.location.assign(result.authorizationUrl);
    } catch (error) {
      notify((error as Error).message, true);
      setBusy("");
    }
  }
  async function connectInstagram() {
    let popup: Window | null = null;
    let channel: BroadcastChannel | undefined;
    if (typeof BroadcastChannel !== "undefined") {
      popup = window.open("", "_blank", "popup,width=610,height=690");
      if (popup) {
        try {
          const channelName = `${instagramPopupSessionKey}.${crypto.randomUUID()}`;
          popup.opener = null;
          popup.sessionStorage.setItem(instagramPopupSessionKey, channelName);
          popup.document.title = "Hubungkan Instagram";
          popup.document.body.textContent = "Membuka login Instagram…";
          channel = new BroadcastChannel(channelName);
        } catch {
          popup.close();
          popup = null;
        }
      }
    }
    setBusy("oauth");
    try {
      const { authorizationUrl } = await api<{ authorizationUrl: string }>(
        "accounts/instagram/oauth",
        "POST",
      );
      if (!popup || !channel) {
        channel?.close();
        window.location.assign(authorizationUrl);
        return;
      }
      if (popup.closed) {
        channel.close();
        setBusy("");
        return;
      }
      const connection = channel;
      const timeout = window.setTimeout(() => connection.close(), 10 * 60_000);
      connection.onmessage = ({ data }) => {
        if (data?.result !== "connected" && data?.result !== "error") return;
        window.clearTimeout(timeout);
        connection.close();
        const success = data.result === "connected";
        if (typeof data.message === "string")
          notify(data.message.slice(0, 300), !success);
        if (success) {
          setEditing(false);
          void onChange().catch((error) => notify((error as Error).message, true));
        }
      };
      popup.location.replace(authorizationUrl);
      setBusy("");
    } catch (error) {
      popup?.close();
      channel?.close();
      notify((error as Error).message, true);
      setBusy("");
    }
  }
  async function connectLinkedIn(form: HTMLFormElement) {
    const fields = new FormData(form);
    setBusy("oauth");
    try {
      const result = await api<{ authorizationUrl: string }>(
        "accounts/linkedin/oauth",
        "POST",
        {
          clientId: fields.get("clientId"),
          clientSecret: fields.get("clientSecret"),
        },
      );
      form.reset();
      window.location.assign(result.authorizationUrl);
    } catch (error) {
      notify((error as Error).message, true);
      setBusy("");
    }
  }
  function resetDiscovery() {
    setChoices([]);
    setSelectedId("");
  }
  async function execute(action: string) {
    setBusy(action);
    try {
      if (action === "discover") {
        resetDiscovery();
        const result = await api<{ accounts: MetaAccountChoice[] }>(
          "accounts/" + platform + "/discover",
          "POST",
          { token },
        );
        setChoices(result.accounts);
        setSelectedId(
          result.accounts.length === 1 ? result.accounts[0].externalId : "",
        );
        notify(
          result.accounts.length === 1
            ? "Akun ditemukan. Periksa namanya, lalu simpan."
            : "Pilih akun tujuan yang ingin dihubungkan.",
        );
        return;
      }
      if (action === "save") {
        if (isMeta)
          await api("accounts/" + platform + "/connect", "POST", {
            token,
            externalId: selectedId,
          });
        else
          await api("accounts/" + platform, "PUT", {
            label,
            externalId,
            token,
            loginType: "facebook",
          });
        setToken("");
        resetDiscovery();
        setEditing(false);
        notify(
          isMeta
            ? "Akun terhubung dan identitas terverifikasi."
            : "Akun disimpan. Jalankan cek koneksi.",
        );
      }
      if (action === "check") {
        const result = await api<AccountInfo>(
          "accounts/" + platform + "/check",
          "POST",
        );
        notify(result.message, result.status !== "CONNECTED");
      }
      if (action === "disconnect") {
        if (
          !confirm(
            "Putus koneksi " +
              platformNames[platform] +
              "? Pekerjaan yang belum dimulai akan dibatalkan.",
          )
        )
          return;
        await api("accounts/" + platform, "DELETE");
        setToken("");
        resetDiscovery();
        setEditing(true);
        notify("Koneksi diputus.");
      }
      await onChange();
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setBusy("");
    }
  }
  return (
    <section className="account-card">
      <div className="account-card-head">
        <span className={"platform-symbol " + platform}>
          <PlatformIcon platform={platform} size={22} />
        </span>
        <div>
          <h2>{platformNames[platform]}</h2>
          <span
            className={
              "status-dot " +
              (account?.status === "CONNECTED" ? "positive" : "")
            }
          >
            {account?.status === "CONNECTED"
              ? "Identitas terverifikasi"
              : account
                ? "Perlu diperiksa"
                : "Belum terhubung"}
          </span>
        </div>
      </div>
      {!editing && account ? (
        <>
          <strong className="account-name">{account.label}</strong>
          {!isMeta && <p className="account-id">{account.externalId}</p>}
          <p className="account-message">{account.message}</p>
          <div className="account-actions">
            <button
              className="button"
              disabled={!!busy}
              onClick={() => execute("check")}
            >
              {busy === "check" ? (
                <LoaderCircle className="spin" size={15} />
              ) : (
                <Link2 size={15} />
              )}
              Cek koneksi
            </button>
            <button
              className="button ghost"
              onClick={() => {
                setManualInstagram(false);
                setManualLinkedIn(false);
                setEditing(true);
              }}
              disabled={!!busy}
            >
              {platform === "instagram"
                ? "Hubungkan ulang"
                : isMeta
                  ? "Ganti token"
                  : platform === "youtube"
                    ? "Hubungkan ulang"
                    : platform === "linkedin"
                      ? "Hubungkan ulang"
                    : "Ubah"}
            </button>
            <button
              className="icon-button danger"
              title="Putus koneksi"
              aria-label={"Putus koneksi " + platformNames[platform]}
              onClick={() => execute("disconnect")}
              disabled={!!busy}
            >
              <Unplug size={16} />
            </button>
          </div>
        </>
      ) : platform === "instagram" && !manualInstagram ? (
        <div className="account-form">
          <p className="field-help">
            Masuk ke akun Instagram profesional dan beri izin publikasi.
          </p>
          <div className="account-actions">
            <button
              className="button primary"
              type="button"
              disabled={!!busy}
              onClick={() => void connectInstagram()}
            >
              {busy === "oauth" ? (
                <LoaderCircle className="spin" size={15} />
              ) : (
                <Link2 size={15} />
              )}
              Hubungkan dengan Instagram
            </button>
            <button
              className="button ghost"
              type="button"
              disabled={!!busy}
              onClick={() => setManualInstagram(true)}
            >
              Gunakan access token
            </button>
            {account && (
              <button
                className="button ghost"
                type="button"
                disabled={!!busy}
                onClick={() => setEditing(false)}
              >
                Batal
              </button>
            )}
          </div>
        </div>
      ) : platform === "youtube" && !manualYoutube ? (
        <form
          className="account-form"
          method="post"
          onSubmit={(event) => {
            event.preventDefault();
            void connectGoogle(event.currentTarget);
          }}
        >
          <label>
            Client ID Google
            <input
              name="clientId"
              required
              maxLength={300}
              autoComplete="off"
              spellCheck={false}
              disabled={!!busy}
              placeholder="…apps.googleusercontent.com"
            />
          </label>
          <label>
            Client Secret Google
            <div className="token-input">
              <KeyRound size={15} />
              <input
                name="clientSecret"
                type="password"
                required
                maxLength={512}
                autoComplete="off"
                spellCheck={false}
                disabled={!!busy}
                placeholder="Tempel Client Secret"
              />
            </div>
          </label>
          <label>
            Redirect URI untuk Google Cloud
            <input
              readOnly
              value={
                typeof window === "undefined"
                  ? ""
                  : window.location.origin + youtubeOAuthCallbackPath
              }
              onFocus={(event) => event.currentTarget.select()}
            />
          </label>
          <p className="field-help">
            Tambahkan URI ini ke Authorized redirect URIs pada OAuth Client tipe
            Web application, lalu pilih kanal dan beri izin di Google.
          </p>
          <div className="account-actions">
            <button className="button primary" type="submit" disabled={!!busy}>
              {busy === "oauth" ? (
                <LoaderCircle className="spin" size={15} />
              ) : (
                <Link2 size={15} />
              )}
              Hubungkan dengan Google
            </button>
            <button
              className="button ghost"
              type="button"
              disabled={!!busy}
              onClick={() => setManualYoutube(true)}
            >
              Gunakan access token
            </button>
            {account && (
              <button
                className="button ghost"
                type="button"
                disabled={!!busy}
                onClick={() => setEditing(false)}
              >
                Batal
              </button>
            )}
          </div>
        </form>
      ) : platform === "linkedin" && !manualLinkedIn ? (
        <form
          className="account-form"
          method="post"
          onSubmit={(event) => {
            event.preventDefault();
            void connectLinkedIn(event.currentTarget);
          }}
        >
          <label>
            Client ID LinkedIn
            <input
              name="clientId"
              required
              maxLength={300}
              autoComplete="off"
              spellCheck={false}
              disabled={!!busy}
              placeholder="Client ID dari LinkedIn Developer Portal"
            />
          </label>
          <label>
            Primary Client Secret LinkedIn
            <div className="token-input">
              <KeyRound size={15} />
              <input
                name="clientSecret"
                type="password"
                required
                maxLength={512}
                autoComplete="off"
                spellCheck={false}
                disabled={!!busy}
                placeholder="Tempel Primary Client Secret"
              />
            </div>
          </label>
          <label>
            Authorized redirect URL LinkedIn
            <input
              readOnly
              value={
                typeof window === "undefined"
                  ? ""
                  : window.location.origin + linkedinOAuthCallbackPath
              }
              onFocus={(event) => event.currentTarget.select()}
            />
          </label>
          <p className="field-help">
            Daftarkan URL ini di Auth → Authorized redirect URLs. Produk Sign In
            with LinkedIn using OpenID Connect dan Share on LinkedIn harus aktif
            agar profil bisa dibaca dan posting ke profil dapat diizinkan.
          </p>
          <div className="account-actions">
            <button className="button primary" type="submit" disabled={!!busy}>
              {busy === "oauth" ? (
                <LoaderCircle className="spin" size={15} />
              ) : (
                <Link2 size={15} />
              )}
              Hubungkan dengan LinkedIn
            </button>
            <button
              className="button ghost"
              type="button"
              disabled={!!busy}
              onClick={() => setManualLinkedIn(true)}
            >
              Gunakan access token
            </button>
            {account && (
              <button
                className="button ghost"
                type="button"
                disabled={!!busy}
                onClick={() => setEditing(false)}
              >
                Batal
              </button>
            )}
          </div>
        </form>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            execute(isMeta && !choices.length ? "discover" : "save");
          }}
          className="account-form"
        >
          {!isMeta && (
            <>
              <label>
                Nama akun
                <input
                  required
                  maxLength={100}
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Nama yang mudah dikenali"
                />
              </label>
              <label>
                {guide.label}
                <input
                  required
                  value={externalId}
                  onChange={(e) => setId(e.target.value)}
                  placeholder={guide.placeholder}
                  autoComplete="off"
                />
              </label>
            </>
          )}
          <label>
            Access token
            <div className="token-input">
              <KeyRound size={15} />
              <input
                type="password"
                value={token}
                onChange={(e) => {
                  setToken(e.target.value);
                  resetDiscovery();
                }}
                required={isMeta || needsManualToken}
                disabled={!!busy}
                maxLength={5000}
                placeholder={
                  !needsManualToken && !isMeta
                    ? "Kosongkan untuk memakai token tersimpan"
                    : "Tempel access token"
                }
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          </label>
          <p className="field-help">{guide.help}</p>
          {isMeta && choices.length > 0 && (
            <div className="detected-account" aria-live="polite">
              {choices.length === 1 ? (
                <>
                  <span className="eyebrow">Akun ditemukan</span>
                  <strong>{choices[0].label}</strong>
                  <p className="field-help">
                    Periksa nama akun sebelum menyimpan koneksi.
                  </p>
                </>
              ) : (
                <label>
                  Pilih{" "}
                  {platform === "facebook" ? "Facebook Page" : "akun Instagram"}
                  <select
                    required
                    value={selectedId}
                    disabled={!!busy}
                    onChange={(e) => setSelectedId(e.target.value)}
                  >
                    <option value="" disabled>
                      Pilih akun tujuan
                    </option>
                    {choices.map((choice) => (
                      <option key={choice.externalId} value={choice.externalId}>
                        {choice.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          )}
          <div className="account-actions">
            <button className="button primary" disabled={!!busy} type="submit">
              {busy === "save" || busy === "discover" ? (
                <LoaderCircle className="spin" size={15} />
              ) : (
                <Check size={15} />
              )}
              {isMeta && !choices.length
                ? busy === "discover"
                  ? "Mendeteksi…"
                  : "Deteksi akun"
                : "Simpan akun"}
            </button>
            {platform === "instagram" && (
              <button
                className="button ghost"
                type="button"
                disabled={!!busy}
                onClick={() => {
                  setToken("");
                  resetDiscovery();
                  setManualInstagram(false);
                }}
              >
                Gunakan login Instagram
              </button>
            )}
            {platform === "youtube" && (
              <button
                className="button ghost"
                type="button"
                disabled={!!busy}
                onClick={() => {
                  setToken("");
                  setManualYoutube(false);
                }}
              >
                Gunakan Google OAuth
              </button>
            )}
            {platform === "linkedin" && (
              <button
                className="button ghost"
                type="button"
                disabled={!!busy}
                onClick={() => {
                  setToken("");
                  setManualLinkedIn(false);
                }}
              >
                Gunakan LinkedIn OAuth
              </button>
            )}
            {account && (
              <button
                className="button ghost"
                type="button"
                disabled={!!busy}
                onClick={() => {
                  setEditing(false);
                  setToken("");
                  resetDiscovery();
                }}
              >
                Batal
              </button>
            )}
          </div>
        </form>
      )}
      <a
        className="documentation-link"
        href={guide.url}
        target="_blank"
        rel="noreferrer"
      >
        Panduan API
        <ExternalLink size={12} />
      </a>
    </section>
  );
}
