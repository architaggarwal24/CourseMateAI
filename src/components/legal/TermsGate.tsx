"use client";

// The Terms / Privacy Policy box inside the app (legal and trust pass): shown once to anyone whose account hasn't
// accepted the current version - a Google or GitHub sign-up, an account from before the box, or everyone after the
// documents change. Nothing else can be used until it is ticked; the server records the version and the time.
import { useState } from "react";
import { Button, Checkbox, Modal, toast } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { API_BASE_URL, throwForResponse } from "@/lib/api/client";
import { AGREE_LABEL, TERMS_VERSION } from "@/lib/legal";

export async function acceptTerms(version = TERMS_VERSION) {
  const res = await fetch(`${API_BASE_URL}/account/terms`, {
    method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ version }),
  });
  if (!res.ok) await throwForResponse(res);
}

export default function TermsGate() {
  const { user, refresh, logout } = useAuth();
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  // an account the server reports (terms_version is null or an older date); never for a user object without it
  if (!user || user.terms_version === undefined || user.terms_version === TERMS_VERSION) return null;
  const updated = !!user.terms_version;

  async function accept() {
    setBusy(true);
    try { await acceptTerms(); await refresh(); }
    catch (e) { toast.apiError(e); }
    setBusy(false);
  }

  return (
    <Modal open onClose={() => {}} dismissible={false} title={updated ? "We've updated our Terms" : "Before you start"}
      actions={<>
        <Button variant="ghost" onClick={() => void logout()}>Sign out</Button>
        <Button variant="primary" disabled={!agreed} loading={busy} onClick={() => void accept()}>Accept and continue</Button>
      </>}>
      <p className="m-0 mb-3 text-fg-2">
        {updated
          ? "The Terms of Service or Privacy Policy changed. Please read them and accept to keep using CourseMateAI."
          : "CourseMateAI is for students aged 12 and up. Please read the Terms of Service and Privacy Policy, then accept them to continue."}
      </p>
      <Checkbox name="agree-terms" checked={agreed} onChange={(e) => setAgreed(e.currentTarget.checked)}
        label={<>{AGREE_LABEL.replace(/Terms of Service and Privacy Policy$/, "")}<a href="/legal/terms" target="_blank" rel="noopener" className="underline">Terms of Service</a> and <a href="/legal/privacy" target="_blank" rel="noopener" className="underline">Privacy Policy</a></>} />
    </Modal>
  );
}
