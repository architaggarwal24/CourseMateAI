import AccountNav from "@/components/shell/AccountNav";
import "@/components/study/study.css";
import "./account.css";

// Account (profile, settings, history) sits in the same floating glass workspace as Study.
export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="ws ws--page">
      <AccountNav />
      <div className="ws-page__body flex-1 min-h-0 overflow-y-auto">{children}</div>
    </div>
  );
}
