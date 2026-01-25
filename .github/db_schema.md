# Database Schema Documentation

This document describes the MySQL database tables used in the **Detect** (Fake News Detection) application.

## Table List

| Table Name | Description |
| :--- | :--- |
| `users` | User accounts and authentication details |
| `system_stats` | Daily statistics (visits, logins, anomalies, blocks) |
| `blocked_logs` | Unified logs for blocked requests (Crawler/Blacklist) |
| `crawler_settings` | Configuration for automated crawler defense |
| `ip_blacklist` | Banned IP addresses |
| `access_today` | Today's unique IP visitors tracking |
| `access_history` | Historical IP access logs (Unique IP + UA) |
| `audit_history` | Analysis history (Previously used by original system) |

---

## Table Details

### 1. `users`
Stores user credentials and status.
- `id`: Primary key (Manual or Auto-inc)
- `username`: Unique username
- `password`: Plaintext (Not recommended for production, but used here)
- `role`: `admin` or `user`
- `status`: `active` or `pending` (for approval)
- `last_login_at`, `last_login_ip`, `last_login_region`: Login tracking
- `token_version`: Used for JWT invalidation

### 2. `system_stats`
Daily metrics engine for the dashboard.
- `stat_date`: Primary key (Date)
- `access_count`: Total requests today
- `unique_visitor_count`: Total unique IPs today
- `login_user_count`: Total successful logins today
- `anomaly_count`: Total webpage scraping anomalies today
- `blocked_count`: Total security blocks today

### 3. `blocked_logs`
Logs of all requests rejected by the security middleware.
- `ip`: Source IP
- `ua`: User-Agent
- `region`: Geographic location
- `reason`: Block reason (e.g., "Crawler (UA)", "IP Banned")
- `block_count`: Number of attempts from this source

### 4. `crawler_settings`
Settings for the automated defense layer.
- `setting_key`: Key (e.g., `ua_min_length`, `ua_keywords`)
- `setting_value`: Value

### 5. `ip_blacklist`
Stored list of explicitly blocked IP addresses.
- `ip`: The blocked IP
- `reason`: Explanation for the block

### 6. `access_today`
Temporary table to track daily unique visitors and their region.
- Increments `hit_count` per IP/Date.

### 7. `access_history`
Aggregated table for permanent IP access history records.
- Stores the last access time and region for each unique IP+UA combination.

### 8. `audit_history`
Stores analysis results for content (Text/Images/URL).
- Includes the extracted text, images (JSON), and LLM results.
