//! models.dev model catalog: embed + on-disk cache + remote refresh + Tauri command.
//!
//! v0.1.4+ 从 Locus 同款 `models.dev/api.json` 搬过来（src-tauri/assets/model_catalog.json.gz）
//! 但做了 Locus 同款 4 件事 —— 不是 v0.1 简化版：
//!
//! 1. **Embedded snapshot**: gzipped 157KB JSON，build 时 `include_bytes!` 嵌进 binary
//! 2. **On-disk cache**: `%APPDATA%/PlotCraft/model_catalog.json` —— fetched_at 比 embedded 新就用 cache
//! 3. **Remote refresh**: `https://models.dev/api.json` → slim → 写盘（env: `PLOTCRAFT_MODELS_URL`）
//! 4. **Background refresh**: app 启动 5s 后 spawn tokio task，cache 超 24h 就拉新；失败不致命，fallback freshest local
//! 5. **Sanity check**: 拉回来的数据 < 50 providers 或 < 1000 models 不写盘（防 broken mirror）
//!
//! AGENTS.md 硬规则 #1：结构对齐 Locus，代码 PlotCraft 自写。
//!  - OFFICIAL_API_FALLBACKS / slim 函数 / OnceLock+Mutex 模式都从 Locus 抄思路，不照搬
//!  - 前端消费 ResolvedCatalog schema（camelCase via serde）

use std::io::Read;
use std::path::PathBuf;
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use chrono::{DateTime, Utc};
use flate2::read::GzDecoder;
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};
use tokio::sync::{Mutex, RwLock};

// === Embedded snapshot + config constants ===

const EMBEDDED_SNAPSHOT_GZ: &[u8] = include_bytes!("../assets/model_catalog.json.gz");
const CACHE_FILE_NAME: &str = "model_catalog.json";
const CACHE_TMP_SUFFIX: &str = ".tmp";
const DEFAULT_SOURCE_URL: &str = "https://models.dev/api.json";
const SOURCE_URL_ENV: &str = "PLOTCRAFT_MODELS_URL";
const REFRESH_TTL: Duration = Duration::from_secs(24 * 60 * 60);
const FETCH_TIMEOUT: Duration = Duration::from_secs(30);
/// 启动后多久开始 background refresh（不阻塞 startup）
const BG_REFRESH_DELAY: Duration = Duration::from_secs(5);
/// sanity check：refresh 拉回来的数据 < 这两个阈值就不写盘（防 broken mirror）
const MIN_SANE_PROVIDERS: usize = 50;
const MIN_SANE_MODELS: usize = 1000;

// === Schema：embedded snapshot + cached file（slim 后的 catalog） ===

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CatalogLimit {
    #[serde(default)]
    pub context: u64,
    #[serde(default)]
    pub output: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CatalogModel {
    pub name: String,
    #[serde(default)]
    pub limit: CatalogLimit,
    #[serde(default)]
    pub reasoning: bool,
    #[serde(default)]
    pub tool_call: bool,
    #[serde(default)]
    pub attachment: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub release_date: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CatalogProvider {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub npm: Option<String>,
    #[serde(default)]
    pub models: IndexMap<String, CatalogModel>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelCatalog {
    #[serde(default)]
    pub fetched_at: String,
    pub providers: IndexMap<String, CatalogProvider>,
}

// === Frontend-facing resolved schema（filter + endpoint fallback 后） ===

#[derive(Debug, Clone, Serialize)]
pub struct ResolvedModel {
    pub id: String,
    pub name: String,
    pub context_window: u64,
    pub output_limit: u64,
    pub reasoning: bool,
    pub tool_call: bool,
    pub vision: bool,
    pub release_date: Option<String>,
    pub status: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ResolvedProvider {
    pub id: String,
    pub name: String,
    pub endpoint: String,
    pub npm: Option<String>,
    pub suggested_api_format: String,
    pub models: Vec<ResolvedModel>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ResolvedCatalog {
    pub fetched_at: String,
    pub providers: Vec<ResolvedProvider>,
}

// === OFFICIAL_API_FALLBACKS（mirror Locus） ===

const OFFICIAL_API_FALLBACKS: &[(&str, &str)] = &[
    ("anthropic", "https://api.anthropic.com"),
    ("openai", "https://api.openai.com/v1"),
    ("google", "https://generativelanguage.googleapis.com/v1beta/openai"),
    ("xai", "https://api.x.ai/v1"),
    ("mistral", "https://api.mistral.ai/v1"),
    ("groq", "https://api.groq.com/openai/v1"),
    ("cohere", "https://api.cohere.ai/compatibility/v1"),
    ("perplexity", "https://api.perplexity.ai"),
    ("togetherai", "https://api.together.xyz/v1"),
    ("deepinfra", "https://api.deepinfra.com/v1/openai"),
    ("cerebras", "https://api.cerebras.ai/v1"),
    ("v0", "https://api.v0.dev/v1"),
    ("vercel", "https://ai-gateway.vercel.sh/v1"),
];

// === Slim 函数：把 models.dev raw JSON 摘到我们用的 schema ===

fn slim_string(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn slim_model(id: &str, raw: &Value) -> CatalogModel {
    let limit = raw.get("limit");
    CatalogModel {
        name: slim_string(raw, "name").unwrap_or_else(|| id.to_string()),
        limit: CatalogLimit {
            context: limit
                .and_then(|l| l.get("context"))
                .and_then(Value::as_u64)
                .unwrap_or(0),
            output: limit
                .and_then(|l| l.get("output"))
                .and_then(Value::as_u64)
                .unwrap_or(0),
        },
        reasoning: raw.get("reasoning").and_then(Value::as_bool).unwrap_or(false),
        tool_call: raw.get("tool_call").and_then(Value::as_bool).unwrap_or(false),
        attachment: raw
            .get("attachment")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        release_date: slim_string(raw, "release_date"),
        status: slim_string(raw, "status"),
    }
}

fn slim_provider(_id: &str, raw: &Value) -> Option<CatalogProvider> {
    // 必须有 name + models 字段才算合法 provider
    let name = slim_string(raw, "name")?;
    let api = slim_string(raw, "api");
    let npm = slim_string(raw, "npm");
    let models_obj = raw.get("models").and_then(Value::as_object);
    let mut models = IndexMap::new();
    if let Some(obj) = models_obj {
        for (mid, mval) in obj {
            if mval.is_object() {
                models.insert(mid.clone(), slim_model(mid, mval));
            }
        }
    }
    Some(CatalogProvider {
        name,
        api,
        npm,
        models,
    })
}

/// 把 models.dev 整个 raw JSON 摘成 ModelCatalog
/// - raw 顶层 = `{ provider_id: provider_obj, ... }`
/// - 失败的 provider（缺 name / 无 models object）跳过
fn slim_catalog(raw: Value) -> ModelCatalog {
    let mut providers = IndexMap::new();
    if let Some(obj) = raw.as_object() {
        for (id, pval) in obj {
            if let Some(p) = slim_provider(id, pval) {
                providers.insert(id.clone(), p);
            }
        }
    }
    ModelCatalog {
        fetched_at: Utc::now().to_rfc3339(),
        providers,
    }
}

// === Cache I/O ===

fn cache_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("cache_path: app_config_dir failed: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("cache_path: mkdir failed: {e}"))?;
    Ok(dir.join(CACHE_FILE_NAME))
}

fn load_cached_catalog(app: &AppHandle) -> Option<ModelCatalog> {
    let path = cache_path(app).ok()?;
    let json = std::fs::read_to_string(&path).ok()?;
    serde_json::from_str(&json).ok()
}

/// 原子写：写 tmp → rename。失败不丢旧文件
fn save_cached_catalog(app: &AppHandle, catalog: &ModelCatalog) -> Result<(), String> {
    let final_path = cache_path(app)?;
    let tmp_path = final_path.with_extension(CACHE_TMP_SUFFIX);
    let json = serde_json::to_string_pretty(catalog)
        .map_err(|e| format!("save_cached: serialize: {e}"))?;
    std::fs::write(&tmp_path, json).map_err(|e| format!("save_cached: write tmp: {e}"))?;
    // 原子 rename（Windows 上 std::fs::rename 跨 fs 会失败，这里都在同一 dir）
    std::fs::rename(&tmp_path, &final_path)
        .map_err(|e| format!("save_cached: rename: {e}"))?;
    Ok(())
}

// === Embedded snapshot parsing ===

fn parse_embedded_snapshot() -> Result<ModelCatalog, String> {
    let mut decoder = GzDecoder::new(EMBEDDED_SNAPSHOT_GZ);
    let mut json = String::new();
    decoder
        .read_to_string(&mut json)
        .map_err(|e| format!("decompress embedded: {e}"))?;
    serde_json::from_str(&json).map_err(|e| format!("parse embedded: {e}"))
}

// === In-memory state（OnceLock + RwLock + Mutex 跟 Locus 同模式） ===

struct CatalogState {
    catalog: Arc<ModelCatalog>,
    /// "embedded" / "cache" / "remote" —— v0.1 不暴露给前端，debug 用
    #[allow(dead_code)]
    source: &'static str,
}

fn catalog_cell() -> &'static RwLock<Option<Arc<CatalogState>>> {
    static CELL: OnceLock<RwLock<Option<Arc<CatalogState>>>> = OnceLock::new();
    CELL.get_or_init(|| RwLock::new(None))
}

fn refresh_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

/// ISO 8601 strings 比较（lexical = chronological for ISO 8601 UTC）
fn freshest(a: &ModelCatalog, b: &ModelCatalog) -> bool {
    a.fetched_at.as_str() > b.fetched_at.as_str()
}

fn load_freshest(app: &AppHandle) -> Result<CatalogState, String> {
    let snapshot = parse_embedded_snapshot()?;
    match load_cached_catalog(app) {
        Some(cached) if freshest(&cached, &snapshot) => Ok(CatalogState {
            catalog: Arc::new(cached),
            source: "cache",
        }),
        _ => Ok(CatalogState {
            catalog: Arc::new(snapshot),
            source: "embedded",
        }),
    }
}

async fn current_state(app: &AppHandle) -> Result<Arc<CatalogState>, String> {
    if let Some(state) = catalog_cell().read().await.as_ref() {
        return Ok(state.clone());
    }
    let mut guard = catalog_cell().write().await;
    if let Some(state) = guard.as_ref() {
        return Ok(state.clone());
    }
    let state = Arc::new(load_freshest(app)?);
    *guard = Some(state.clone());
    Ok(state)
}

/// 把当前 in-memory state 替换成新 catalog（refresh 后调用）
async fn replace_state(catalog: ModelCatalog) -> Result<(), String> {
    let mut guard = catalog_cell().write().await;
    *guard = Some(Arc::new(CatalogState {
        catalog: Arc::new(catalog),
        source: "remote",
    }));
    Ok(())
}

// === Resolve + api_format（跟之前一样） ===

fn resolve_endpoint(provider_id: &str, p: &CatalogProvider) -> Option<String> {
    if let Some(api) = &p.api {
        if !api.is_empty() && !api.contains("${") {
            return Some(api.clone());
        }
    }
    OFFICIAL_API_FALLBACKS
        .iter()
        .find(|(k, _)| *k == provider_id)
        .map(|(_, v)| v.to_string())
        .filter(|s| !s.is_empty())
}

pub fn suggested_api_format(npm: Option<&str>) -> &'static str {
    match npm {
        Some("@ai-sdk/anthropic") => "anthropic_messages",
        _ => "openai_chat",
    }
}

fn resolve_model(id: &str, m: &CatalogModel) -> ResolvedModel {
    ResolvedModel {
        id: id.to_string(),
        name: m.name.clone(),
        context_window: m.limit.context,
        output_limit: m.limit.output,
        reasoning: m.reasoning,
        tool_call: m.tool_call,
        vision: m.attachment,
        release_date: m.release_date.clone(),
        status: m.status.clone(),
    }
}

fn is_listable_model(m: &CatalogModel) -> bool {
    m.status.as_deref() != Some("deprecated") && m.tool_call
}

pub fn get_resolved_catalog_inner(catalog: &ModelCatalog) -> ResolvedCatalog {
    let mut providers = Vec::new();
    for (id, p) in &catalog.providers {
        let Some(endpoint) = resolve_endpoint(id, p) else {
            continue;
        };
        let models: Vec<ResolvedModel> = p
            .models
            .iter()
            .filter(|(_, m)| is_listable_model(m))
            .map(|(mid, m)| resolve_model(mid, m))
            .collect();
        if models.is_empty() {
            continue;
        }
        providers.push(ResolvedProvider {
            id: id.clone(),
            name: p.name.clone(),
            endpoint,
            npm: p.npm.clone(),
            suggested_api_format: suggested_api_format(p.npm.as_deref()).to_string(),
            models,
        });
    }
    ResolvedCatalog {
        fetched_at: catalog.fetched_at.clone(),
        providers,
    }
}

// === Remote refresh ===

fn source_url() -> String {
    match std::env::var(SOURCE_URL_ENV) {
        Ok(v) if !v.trim().is_empty() => v.trim().to_string(),
        _ => DEFAULT_SOURCE_URL.to_string(),
    }
}

/// 拉 raw + slim + sanity check + 写盘 + 替换 in-memory state
/// 返回 (slim_catalog, 来源描述) 供 caller 展示
async fn refresh_catalog_inner(app: &AppHandle) -> Result<(ModelCatalog, &'static str), String> {
    // 防并发 refresh（多点按钮/多窗口/启动 race）
    let _guard = refresh_lock().lock().await;

    let url = source_url();
    eprintln!("[model_catalog] refresh: GET {url}");

    let client = reqwest::Client::builder()
        .connect_timeout(FETCH_TIMEOUT)
        .timeout(FETCH_TIMEOUT)
        .build()
        .map_err(|e| format!("refresh: client build: {e}"))?;

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("refresh: GET {url}: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!(
            "refresh: GET {url}: HTTP {}",
            resp.status()
        ));
    }
    let raw: Value = resp
        .json()
        .await
        .map_err(|e| format!("refresh: parse JSON: {e}"))?;

    let slim = slim_catalog(raw);

    // Sanity check：防 broken mirror / truncated response 写盘
    let total_models: usize = slim.providers.values().map(|p| p.models.len()).sum();
    if slim.providers.len() < MIN_SANE_PROVIDERS {
        return Err(format!(
            "refresh: sanity check failed — got {} providers, expected >= {}",
            slim.providers.len(),
            MIN_SANE_PROVIDERS
        ));
    }
    if total_models < MIN_SANE_MODELS {
        return Err(format!(
            "refresh: sanity check failed — got {} models, expected >= {}",
            total_models,
            MIN_SANE_MODELS
        ));
    }

    // 写盘（失败不致命 —— 内存里的新 catalog 还能用）
    if let Err(e) = save_cached_catalog(app, &slim) {
        eprintln!("[model_catalog] refresh: cache write failed (continuing with in-memory): {e}");
    } else {
        eprintln!(
            "[model_catalog] refresh: cached {} providers / {} models to disk",
            slim.providers.len(),
            total_models
        );
    }

    // 替换 in-memory state
    replace_state(slim.clone()).await?;

    Ok((slim, "remote"))
}

/// Background refresh：app 启动后 spawn 一次
/// - 第一次启动或 cache 缺失 → 等 5s 就拉（首次玩家体验好）
/// - cache 已有且新于 24h → 不动
/// - cache 已有但旧于 24h → 等 5s 就拉
/// - 失败 → 静默（fallback freshest local data）
pub fn spawn_background_refresh(app: AppHandle) {
    tokio::spawn(async move {
        tokio::time::sleep(BG_REFRESH_DELAY).await;

        // 决定要不要 refresh
        let needs_refresh = match current_state(&app).await {
            Ok(state) => {
                if let Ok(parsed) =
                    DateTime::parse_from_rfc3339(&state.catalog.fetched_at)
                {
                    let age = Utc::now()
                        .signed_duration_since(parsed.with_timezone(&Utc));
                    age > chrono::Duration::from_std(REFRESH_TTL).unwrap_or_default()
                } else {
                    true
                }
            }
            Err(_) => true,
        };

        if !needs_refresh {
            eprintln!("[model_catalog] bg refresh: cache fresh, skipping");
            return;
        }

        if let Err(e) = refresh_catalog_inner(&app).await {
            eprintln!("[model_catalog] bg refresh: failed (using local fallback): {e}");
        } else {
            eprintln!("[model_catalog] bg refresh: ok");
        }
    });
}

// === Tauri commands ===

#[tauri::command]
pub async fn get_model_catalog(app: AppHandle) -> Result<ResolvedCatalog, String> {
    // v0.1.4+ fix: 之前用 `futures::executor::block_on` 同步跑 future，
    // 但 future 内部用 tokio RwLock → panic "no reactor running"。
    // Tauri 2 command 默认就是 async（tokio runtime），直接 await 即可。
    let state = current_state(&app)
        .await
        .map_err(|e| format!("get_model_catalog: {e}"))?;
    Ok(get_resolved_catalog_inner(&state.catalog))
}

#[tauri::command]
pub async fn refresh_model_catalog(app: AppHandle) -> Result<ResolvedCatalog, String> {
    let (slim, _source) = refresh_catalog_inner(&app).await?;
    Ok(get_resolved_catalog_inner(&slim))
}

// === Tests ===

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slim_string_extracts_field() {
        let v = serde_json::json!({"name": "x", "reasoning": true});
        assert_eq!(slim_string(&v, "name"), Some("x".to_string()));
        assert_eq!(slim_string(&v, "missing"), None);
    }

    #[test]
    fn slim_model_default_fields() {
        let raw = serde_json::json!({
            "name": "Test Model",
            "limit": { "context": 200000, "output": 8192 },
            "reasoning": true,
            "tool_call": true
        });
        let m = slim_model("test-id", &raw);
        assert_eq!(m.name, "Test Model");
        assert_eq!(m.limit.context, 200_000);
        assert_eq!(m.limit.output, 8192);
        assert!(m.reasoning);
        assert!(m.tool_call);
        assert!(!m.attachment); // 缺省 false
        assert!(m.release_date.is_none());
    }

    #[test]
    fn slim_model_missing_name_uses_id() {
        let raw = serde_json::json!({});
        let m = slim_model("fallback-id", &raw);
        assert_eq!(m.name, "fallback-id");
    }

    #[test]
    fn slim_provider_requires_name() {
        let raw = serde_json::json!({"models": {}});
        assert!(slim_provider("p", &raw).is_none());

        let raw2 = serde_json::json!({"name": "Provider", "models": {}});
        let p = slim_provider("p", &raw2).unwrap();
        assert_eq!(p.name, "Provider");
        assert_eq!(p.models.len(), 0);
    }

    #[test]
    fn slim_catalog_skips_invalid_providers() {
        let raw = serde_json::json!({
            "valid": {"name": "Valid", "models": {}},
            "invalid_no_name": {"models": {}},
            "not_an_object": "string"
        });
        let cat = slim_catalog(raw);
        assert_eq!(cat.providers.len(), 1);
        assert!(cat.providers.contains_key("valid"));
        assert!(!cat.fetched_at.is_empty());
    }

    #[test]
    fn freshest_picks_newer_iso_string() {
        let a = ModelCatalog {
            fetched_at: "2026-07-16T15:58:18.918Z".to_string(),
            providers: IndexMap::new(),
        };
        let b = ModelCatalog {
            fetched_at: "2026-07-16T15:58:18.000Z".to_string(),
            providers: IndexMap::new(),
        };
        assert!(freshest(&a, &b));
        assert!(!freshest(&b, &a));
    }

    #[test]
    fn embedded_snapshot_parses() {
        let catalog = parse_embedded_snapshot().expect("parse");
        assert!(!catalog.providers.is_empty(), "no providers parsed");
        let anth = catalog.providers.get("anthropic").expect("anthropic");
        assert!(!anth.models.is_empty(), "anthropic no models");
    }

    #[test]
    fn resolved_catalog_has_usable_providers() {
        let catalog = parse_embedded_snapshot().expect("parse");
        let resolved = get_resolved_catalog_inner(&catalog);
        assert!(
            resolved.providers.len() >= 30,
            "expected at least 30 listable providers, got {}",
            resolved.providers.len()
        );
        let anth = resolved
            .providers
            .iter()
            .find(|p| p.id == "anthropic")
            .expect("anthropic");
        assert!(anth.endpoint.starts_with("https://"));
        let sonnet = anth.models.iter().find(|m| m.id == "claude-sonnet-4-5");
        assert!(sonnet.is_some(), "expected claude-sonnet-4-5");
    }

    #[test]
    fn resolved_catalog_no_template_endpoints() {
        let catalog = parse_embedded_snapshot().expect("parse");
        let resolved = get_resolved_catalog_inner(&catalog);
        let with_template = resolved
            .providers
            .iter()
            .filter(|p| p.endpoint.contains("${") || p.endpoint.is_empty())
            .count();
        assert_eq!(
            with_template, 0,
            "resolved providers should not have template or empty endpoints"
        );
    }

    #[test]
    fn suggested_api_format_anthropic_npm() {
        assert_eq!(
            suggested_api_format(Some("@ai-sdk/anthropic")),
            "anthropic_messages"
        );
        assert_eq!(
            suggested_api_format(Some("@ai-sdk/openai-compatible")),
            "openai_chat"
        );
        assert_eq!(suggested_api_format(None), "openai_chat");
    }

    #[test]
    fn listable_model_filters_deprecated() {
        let m_ok = CatalogModel {
            name: "x".to_string(),
            limit: CatalogLimit::default(),
            reasoning: false,
            tool_call: true,
            attachment: false,
            release_date: None,
            status: None,
        };
        assert!(is_listable_model(&m_ok));
        let m_old = CatalogModel {
            name: "x".to_string(),
            limit: CatalogLimit::default(),
            reasoning: false,
            tool_call: true,
            attachment: false,
            release_date: None,
            status: Some("deprecated".to_string()),
        };
        assert!(!is_listable_model(&m_old));
        let m_no_tools = CatalogModel {
            name: "x".to_string(),
            limit: CatalogLimit::default(),
            reasoning: false,
            tool_call: false,
            attachment: false,
            release_date: None,
            status: None,
        };
        assert!(!is_listable_model(&m_no_tools));
    }
}
