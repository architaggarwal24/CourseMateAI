"""Who is calling, and over what: the client address and scheme, honouring X-Forwarded-* ONLY from trusted proxies.

The backend usually sits behind something (the Next.js rewrite, nginx, a cloud load balancer) so the TCP peer is
that proxy, not the user. The forwarded headers name the real client - but anyone can send them, so they are
believed only when the peer is a proxy on this host or private network (TRUSTED_PROXY_NETWORKS), and the address is read from the RIGHT of
X-Forwarded-For: the first hop that is not one of our own proxies. Whatever a client puts to the left is ignored.
"""
import ipaddress
from typing import Optional

from fastapi import Request

# Where our own proxies live: this host, or a private network (docker-compose, nginx on the same machine, a cloud
# load balancer inside the VPC). Nothing on a public address is ever believed.
TRUSTED_PROXY_NETWORKS = ("127.0.0.0/8", "::1/128", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "fc00::/7")

_networks = tuple(ipaddress.ip_network(n) for n in TRUSTED_PROXY_NETWORKS)


def _ip(value: str) -> Optional[ipaddress._BaseAddress]:
    try:
        return ipaddress.ip_address(value.strip().strip("[]"))
    except ValueError:
        return None


def _trusted(value: str) -> bool:
    ip = _ip(value)
    return ip is not None and any(ip in net for net in _networks)


def _peer(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def client_ip(request: Request) -> str:
    """The caller's address: the TCP peer, or - when the peer is a trusted proxy - the nearest address in
    X-Forwarded-For that is not itself a trusted proxy."""
    peer = _peer(request)
    if not _trusted(peer):
        return peer
    chain = [h.strip() for h in ",".join(request.headers.getlist("x-forwarded-for")).split(",") if h.strip()]
    for hop in reversed(chain):
        if _ip(hop) is None:
            return peer                   # garbage in the header: don't guess
        if not _trusted(hop):
            return hop
    return chain[0] if chain and _ip(chain[0]) else peer     # every hop is ours: the original caller


def request_is_https(request: Request) -> bool:
    """True when the user's browser talked https to us (directly, or to a trusted proxy that says so)."""
    if request.url.scheme == "https":
        return True
    if not _trusted(_peer(request)):
        return False
    protos = ",".join(request.headers.getlist("x-forwarded-proto")).lower().split(",")
    return any(p.strip() == "https" for p in protos)


def rate_limit_key(request: Request) -> str:
    """Rate limits are per signed-in user; anonymous routes (login, register) are per client address.
    The auth dependency records the user on the request before the limited endpoint runs."""
    user_id = getattr(request.state, "rate_limit_user", None)
    return f"user:{user_id}" if user_id is not None else f"ip:{client_ip(request)}"
