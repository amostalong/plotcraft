//! models.dev model catalog: embed + parse + Tauri command.
//!
//! v0.1.4+ 从 Locus 同款 `models.dev/api.json` slim snapshot 搬过来
//! （src-tauri/assets/model_catalog.json.gz，~157KB gzipped，~167 providers / ~1500 models）
//!
//! AGENTS.md 硬规则 #1：结构对齐 Locus，代码 PlotCraft 自写。
//! - 数据格式跟 Locus 一致（slim schema：name / limit / reasoning / tool_call / attachment ...）
//! - OFFICIAL_API_FALLBACKS 镜像 Locus 列表（providers whose models.dev entry 缺 `api` 时用）
//! - v0.1 不上 disk cache / 远端 refresh —— 跟 snapshot 走就够（自用项目，rebuild 重新 fetch 很轻）
//! - v0.2+ 要加 cache + refresh 时参考 Locus `src-tauri/src/model_catalog.rs:142-175`

use std::io::Read;
use std::sync::{Arc, OnceLock};

use flate2::read::GzDecoder;
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};

const EMBEDDED_SNAPSHOT_GZ: &[u8] = include_bytes!("../assets/model_catalog.json.gz");

// === Raw slim snapshot schema（跟 Locus 一样，serde 反序列化用） ===

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
    /// model id（key in IndexMap）—— 玩家发给 LLM 的 model 字段
    pub id: String,
    /// display name
    pub name: String,
    /// 上下文窗口 token 数
    pub context_window: u64,
    /// 最大输出 token 数
    pub output_limit: u64,
    /// 是否支持 reasoning / thinking
    pub reasoning: bool,
    /// 是否支持 tool_call
    pub tool_call: bool,
    /// 是否支持 vision（attachment=true 或 modalities.input 含 image）
    pub vision: bool,
    /// ISO 发布日期
    pub release_date: Option<String>,
    /// 'deprecated' 等（v0.1 暂不直接消费，前端拿到后自己判）
    pub status: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ResolvedProvider {
    /// provider id（'anthropic' / 'openai' / 'deepseek' ...）
    pub id: String,
    /// display name
    pub name: String,
    /// 已 fallback 的 endpoint（优先 provider.api，否则 OFFICIAL_API_FALLBACKS）
    pub endpoint: String,
    /// npm SDK id（前端用于判断 apiFormat 路由）
    pub npm: Option<String>,
    /// 建议的 apiFormat（'anthropic_messages' / 'openai_chat'）—— 前端用这做 default
    pub suggested_api_format: String,
    /// listable models（过滤掉 deprecated + 没 tool_call 的）
    pub models: Vec<ResolvedModel>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ResolvedCatalog {
    /// snapshot fetched_at（ISO 8601 字符串）
    pub fetched_at: String,
    /// 167 providers 里过滤出来的有 endpoint 的
    pub providers: Vec<ResolvedProvider>,
}

// === OFFICIAL_API_FALLBACKS（镜像 Locus：providers whose models.dev entry has no `api`） ===

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
    ("minimax", ""), // 用户会通过 OPENAI_BASE_URL 之类配
];

fn parse_embedded_snapshot() -> Result<ModelCatalog, String> {
    let mut decoder = GzDecoder::new(EMBEDDED_SNAPSHOT_GZ);
    let mut json = String::new();
    decoder
        .read_to_string(&mut json)
        .map_err(|e| format!("Failed to decompress embedded model catalog: {e}"))?;
    serde_json::from_str(&json).map_err(|e| format!("Failed to parse embedded model catalog: {e}"))
}

static CATALOG: OnceLock<Arc<ModelCatalog>> = OnceLock::new();

fn get_catalog() -> Result<Arc<ModelCatalog>, String> {
    if let Some(c) = CATALOG.get() {
        return Ok(c.clone());
    }
    let parsed = Arc::new(parse_embedded_snapshot()?);
    let _ = CATALOG.set(parsed.clone());
    Ok(parsed)
}

/// 从 (provider_id, provider) 解析 endpoint —— provider.api 优先，否则 OFFICIAL_API_FALLBACKS
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

/// npm SDK → 建议的 apiFormat（v0.1 简化为 3 种 PlotCraft 支持的）
///  - `@ai-sdk/anthropic` → anthropic_messages
///  - 其他 → openai_chat（openai_responses 用户在 config 阶段改）
pub fn suggested_api_format(npm: Option<&str>) -> &'static str {
    match npm {
        Some("@ai-sdk/anthropic") => "anthropic_messages",
        _ => "openai_chat",
    }
}

/// 把 model 简化成 ResolvedModel
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

/// 模型是否 listable（不过滤的规则：非 deprecated + tool_call 支持）
/// v0.1 跟 Locus 一致 —— deprecated + 无 tool_call 的隐藏
fn is_listable_model(m: &CatalogModel) -> bool {
    m.status.as_deref() != Some("deprecated") && m.tool_call
}

/// 解析整个 catalog —— 过滤掉没 endpoint / 没 listable model 的 provider
pub fn get_resolved_catalog() -> Result<ResolvedCatalog, String> {
    let raw = get_catalog()?;
    let mut providers = Vec::new();
    for (id, p) in &raw.providers {
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
    Ok(ResolvedCatalog {
        fetched_at: raw.fetched_at.clone(),
        providers,
    })
}

/// 查单个 provider —— 前端可按需单独拿（v0.1 暂用不上，先放这）
#[tauri::command]
pub fn get_model_catalog() -> Result<ResolvedCatalog, String> {
    get_resolved_catalog()
}

// === Tests ===

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_snapshot_parses() {
        let catalog = get_catalog().expect("parse");
        assert!(!catalog.providers.is_empty(), "no providers parsed");
        // anthropic 必有
        let anth = catalog.providers.get("anthropic").expect("anthropic");
        assert!(!anth.models.is_empty(), "anthropic no models");
    }

    #[test]
    fn resolved_catalog_has_usable_providers() {
        let resolved = get_resolved_catalog().expect("resolve");
        assert!(
            resolved.providers.len() >= 30,
            "expected at least 30 listable providers, got {}",
            resolved.providers.len()
        );
        // anthropic 必有且有 claude-sonnet-4-5
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
        // resolved 里不应该出现带 ${...} 的 endpoint
        // （resolve_endpoint 检测到 template 不会再用，OFFICIAL_API_FALLBACKS 兜底也是非 template）
        let resolved = get_resolved_catalog().unwrap();
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
        assert_eq!(suggested_api_format(Some("@ai-sdk/anthropic")), "anthropic_messages");
        assert_eq!(suggested_api_format(Some("@ai-sdk/openai-compatible")), "openai_chat");
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
