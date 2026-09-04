"use client";

import React, { useState } from 'react';
import { Paperclip, Send, X, AlertTriangle } from 'lucide-react';

export default function TradeChatFileUploader({
  tradeId,
  onFileSent,
}: {
  tradeId: string;
  onFileSent: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [cloudLink, setCloudLink] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [warningMessage, setWarningMessage] = useState<string | null>(null);

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    setErrorMessage(null);
    setWarningMessage(null);

    // Client-side video check
    if (file.type.startsWith('video/') && file.size > 30 * 1024 * 1024) {
      setErrorMessage('Video exceeds 30 MB limit. Share via Google Drive or Dropbox link.');
      setShowLinkInput(true);
      return;
    }

    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch(`/api/trades/${tradeId}/files/upload`, {
        method: 'POST',
        body: formData,
      });

      const result = await res.json();
      setUploading(false);

      if (!res.ok) {
        if (result.error === 'LIMIT_REACHED') {
          setErrorMessage(result.message);
          setShowLinkInput(true);
        } else {
          setErrorMessage(result.error || result.message || 'Upload failed');
        }
      } else {
        if (result.warning) {
          setWarningMessage(result.warning);
        }
        onFileSent();
      }
    } catch (err: any) {
      setUploading(false);
      setErrorMessage(err.message || 'Upload failed');
    }
  }

  async function handleSubmitLink() {
    if (!cloudLink.trim()) return;
    setUploading(true);
    setErrorMessage(null);

    const formData = new FormData();
    formData.append('externalUrl', cloudLink.trim());

    try {
      const res = await fetch(`/api/trades/${tradeId}/files/upload`, {
        method: 'POST',
        body: formData,
      });

      const result = await res.json();
      setUploading(false);

      if (res.ok) {
        setCloudLink('');
        setShowLinkInput(false);
        setWarningMessage('PHISHING WARNING: Remember to exercise caution when opening external links provided by trade counterparties.');
        onFileSent();
      } else {
        setErrorMessage(result.error || 'Failed to submit link');
      }
    } catch (err: any) {
      setUploading(false);
      setErrorMessage(err.message || 'Failed to submit link');
    }
  }

  return (
    <div className="p-3 bg-slate-900 border-t border-slate-800 space-y-2">
      {errorMessage && (
        <div className="p-2.5 bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs rounded-lg flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
          <span>{errorMessage}</span>
        </div>
      )}

      {warningMessage && (
        <div className="p-2.5 bg-amber-500/15 border border-amber-500/40 text-amber-200 text-xs rounded-lg flex items-start justify-between gap-2">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
            <span>⚠️ {warningMessage}</span>
          </div>
          <button
            onClick={() => setWarningMessage(null)}
            className="text-amber-400 hover:text-amber-200"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {showLinkInput ? (
        <div className="flex items-center gap-2">
          <input
            type="url"
            value={cloudLink}
            onChange={(e) => setCloudLink(e.target.value)}
            placeholder="Paste Google Drive, Dropbox, or OneDrive link..."
            className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-slate-500 focus:outline-hidden focus:border-emerald-500"
          />
          <button
            onClick={handleSubmitLink}
            disabled={uploading || !cloudLink.trim()}
            className="bg-emerald-500 text-slate-950 font-bold px-3 py-1.5 text-xs rounded-lg hover:bg-emerald-400 disabled:opacity-50 transition cursor-pointer flex items-center gap-1"
          >
            <Send className="w-3 h-3" />
            {uploading ? 'Sending...' : 'Send Link'}
          </button>
          <button
            onClick={() => {
              setShowLinkInput(false);
              setErrorMessage(null);
            }}
            className="p-1.5 text-slate-400 hover:text-slate-200"
            title="Cancel"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <label className="cursor-pointer inline-flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-xs px-3 py-2 rounded-lg border border-slate-700 text-slate-300 transition">
              <Paperclip className="w-3.5 h-3.5" />
              {uploading ? 'Uploading...' : 'Attach File'}
              <input
                type="file"
                accept="image/*,video/mp4,video/webm,application/pdf,.doc,.docx"
                className="hidden"
                onChange={handleFileUpload}
                disabled={uploading}
              />
            </label>
            <button
              onClick={() => setShowLinkInput(true)}
              className="text-xs text-slate-400 hover:text-slate-200 underline underline-offset-2"
            >
              Share cloud link
            </button>
          </div>
          <span className="text-[10px] text-slate-500">Max 3 images, 3 docs, 3 videos (≤30MB)</span>
        </div>
      )}
    </div>
  );
}
