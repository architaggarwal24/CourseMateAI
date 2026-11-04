"""Admin commands for plans and invite codes (Phase 3 Stage 4a; docs/plans.md).

Run from backend/ with the server's .env (it opens the same database):

    python scripts/admin.py invite create --tier sage --days 30 --uses 20 --note "first testers"
    python scripts/admin.py invite create --tier scholar --code BETA-SCHOLAR --days 14 --uses 50 --valid-days 7
    python scripts/admin.py invite list
    python scripts/admin.py invite revoke BETA-SCHOLAR
    python scripts/admin.py plan set someone@example.com sage --days 30      (no --days: no end)
    python scripts/admin.py plan clear someone@example.com                   (back to DEFAULT_TIER)
    python scripts/admin.py usage someone@example.com
    python scripts/admin.py costs --days 30                                  (per model and job; top users)
    python scripts/admin.py routes                                           (which model answers what, per plan)

A user is named by email, username or numeric id.
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def _user_id(db, who: str) -> int:
    if who.isdigit():
        row = db.get_user_by_id(int(who))
    else:
        row = db.get_user_by_email(who.lower()) or next(iter(db.query("SELECT * FROM users WHERE username = ?", [who])), None)
    if not row:
        raise SystemExit(f"No user {who!r}.")
    return int(row["id"])


def main(argv=None, out=print) -> int:
    p = argparse.ArgumentParser(prog="admin.py", description="Plans and invite codes")
    sub = p.add_subparsers(dest="cmd", required=True)
    inv = sub.add_parser("invite").add_subparsers(dest="action", required=True)
    c = inv.add_parser("create")
    c.add_argument("--tier", required=True, choices=["apprentice", "scholar", "sage", "archmage"])
    c.add_argument("--days", type=int, default=30, help="how long the plan lasts once redeemed (0 = no end)")
    c.add_argument("--uses", type=int, default=1)
    c.add_argument("--code")
    c.add_argument("--valid-days", type=int, help="the code itself stops working after this many days")
    c.add_argument("--note", default="")
    inv.add_parser("list")
    r = inv.add_parser("revoke")
    r.add_argument("code")
    plan = sub.add_parser("plan").add_subparsers(dest="action", required=True)
    s = plan.add_parser("set")
    s.add_argument("user")
    s.add_argument("tier", choices=["apprentice", "scholar", "sage", "archmage"])
    s.add_argument("--days", type=int)
    cl = plan.add_parser("clear")
    cl.add_argument("user")
    u = sub.add_parser("usage")
    u.add_argument("user")
    co = sub.add_parser("costs")
    co.add_argument("--days", type=int, default=30)
    sub.add_parser("routes")
    args = p.parse_args(argv)

    import state                                   # opens (and migrates) the server's database
    svc = state.invite_service
    if args.cmd == "invite" and args.action == "create":
        row = svc.create(args.tier, days=args.days or None, max_uses=args.uses, code=args.code, note=args.note,
                         valid_days=args.valid_days)
        out(f"{row['code']}  {row['tier']}  {row['days'] or 'no end'} days  {row['max_uses']} uses"
            + (f"  code valid until {row['expires_at']}" if row["expires_at"] else ""))
    elif args.cmd == "invite" and args.action == "list":
        for row in svc.list():
            state_ = "revoked" if row["revoked"] else f"{row['uses']}/{row['max_uses']} used"
            out(f"{row['code']:<24} {row['tier']:<10} {str(row['days'] or '-'):>4}d  {state_}  {row['note'] or ''}")
    elif args.cmd == "invite" and args.action == "revoke":
        out("revoked" if svc.revoke(args.code) else "no such code")
    elif args.cmd == "plan" and args.action == "set":
        row = svc.set_plan(_user_id(state.db, args.user), args.tier, days=args.days)
        out(f"user {row['user_id']} is on {row['tier']} until {row['expires_at'] or 'no end'}")
    elif args.cmd == "plan" and args.action == "clear":
        svc.clear_plan(_user_id(state.db, args.user))
        out("back on the default plan")
    elif args.cmd == "usage":
        uid = _user_id(state.db, args.user)
        out(json.dumps(state.usage_service.summary(uid, documents=state.documents.repo.count_for_user(uid), courses=0,
                                                   byok=False), indent=2))
    elif args.cmd == "costs":
        c = state.usage_service.costs(args.days)
        inr = f" (₹{c['total_inr']:,.2f})" if c["total_inr"] is not None else ""
        out(f"Last {c['days']} days: ${c['total_usd']:,.4f}{inr}")
        for m in c["models"]:
            out(f"  {m['provider']}:{m['model']:<34} {m['job']:<6} {m['calls']:>6} calls  "
                f"{m['tokens_in'] + m['tokens_out']:>10} tokens  ${m['cost_usd']:,.4f}"
                + ("" if m["priced"] else "  (no price)") + (f"  {m['fallbacks']} fallbacks" if m["fallbacks"] else ""))
        if c["unpriced"]:
            out("No price set for: " + ", ".join(c["unpriced"]) + "  (MODEL_PRICES_JSON)")
        for u_ in c["top_users"]:
            out(f"  user {u_['user_id']}: {u_['calls']} calls, ${u_['cost_usd']:,.4f}")
    elif args.cmd == "routes":
        from config import settings
        from core_brains import model_router
        for tier in ("apprentice", "scholar", "sage", "archmage"):
            for job in model_router.JOBS:
                targets = model_router.plan(job, tier, tuple(settings.fallback_llm_keys))
                out(f"{tier:<10} {job:<6} " + (" -> ".join(f"{t.slot}={t.label}" for t in targets) or "(no server AI configured)"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
