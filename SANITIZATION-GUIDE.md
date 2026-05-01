# Blog Post Sanitization Guide

Standard reference card for sanitizing infrastructure details in blog posts. Based on RFC 5737, RFC 2606, and industry best practices.

## IP Addresses (RFC 5737)

Use ONLY these documentation-reserved ranges in examples:

| Range | Name | Example | Use For |
|-------|------|---------|---------|
| `192.0.2.0/24` | TEST-NET-1 | `192.0.2.1` | Primary examples (server IPs) |
| `198.51.100.0/24` | TEST-NET-2 | `198.51.100.42` | Secondary (ISP hops, routers) |
| `203.0.113.0/24` | TEST-NET-3 | `203.0.113.50` | Third party services |

- `192.168.x.x` and `10.0.0.x` are OK for private/local network examples
- IPv6: `2001:db8::1` (RFC 3849)
- NEVER use real public IPs from our infrastructure

## Domains (RFC 2606)

| Domain | Use For |
|--------|---------|
| `example.com` | Generic examples |
| `example.org` | Alternative examples |
| `*.example` | Subdomain examples |
| `.test` | Testing examples |

- Real project domains (southernsky.cloud, etc.) are OK when referencing the live product
- NEVER use real domains in SSH/SCP commands or config examples

## Hostnames & Machine Names

| Real Name | Replacement |
|-----------|-------------|
| Zeus | `workstation` or `dev-machine` |
| Hera | `mac-studio` or `editing-machine` |
| Atlas | `nas` or `storage-server` |
| Ares | `projector-pc` |
| Artemis | `laptop` |

## Usernames

| Context | Placeholder |
|---------|-------------|
| SSH commands | `user@192.0.2.1` |
| System prompts | `user@workstation:~$` |
| Deploy scripts | `deploy@192.0.2.1` |
| GitHub URLs | Real username OK (public) |

## Secrets & Credentials

- API keys: `YOUR_API_KEY` or `sk_live_xxxxxxxxxxxxxxxxxxxx`
- Tokens: `ghp_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX`
- Passwords: `your-secure-password` or env var reference
- File paths: `~/.env-keys` (generic) not `~/.env-ai-keys` (real)
- Config files: Show env var pattern (`process.env.API_KEY`)

## Infrastructure Details to NEVER Include

- VPS IP addresses
- Tailscale mesh IPs or node names
- ISP router hostnames (contain city names)
- SSH connection strings with real hosts
- Mount points that reveal storage layout
- Docker bridge gateway IPs
- Port mappings (OK in generic form: `4006:3000`)
- Firewall rules referencing real IPs

## Blog-Specific Conventions

For consistency across all SouthernSky blog posts:

| Concept | Standard Placeholder |
|---------|---------------------|
| Our VPS | `192.0.2.50` or `your-server` |
| Our workstation | `192.168.1.100` |
| Router | `192.168.1.1` |
| ISP hops | `198.51.100.x` |
| Deploy target | `deploy@192.0.2.50` |
| Example domain | `myblog.example.com` |

## Pre-Publish Checklist

```bash
# Scan for real IPs
grep -rn -E '104\.|100\.117|100\.73|68\.87|96\.120|96\.110' src/content/posts/

# Scan for real hostnames
grep -rni 'zeus\|hera\|atlas\|ares\|artemis' src/content/posts/

# Scan for real usernames in system contexts
grep -rn 'jmartin@\|danko@' src/content/posts/

# Scan for credential paths
grep -rn '\.env-ai-keys\|DROPBOX_\|GROK_API\|GEMINI_API' src/content/posts/

# Scan for Tailscale
grep -rni 'tailscale\|tailnet' src/content/posts/
```
