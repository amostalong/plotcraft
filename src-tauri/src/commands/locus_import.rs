//! Import from Locus config —— 把 Locus 的设置迁移到 PlotCraft
//!
//! Locus 存什么：
//! - 主 config：`%APPDATA%/Locus/config.json`（24 顶层字段，跟 PlotCraft shape 同构）
//! - custom providers：`%APPDATA%/Locus/custom_providers.json`（独立文件，array of
//!   Locus `CustomProvider` with full details: id/name/endpoint/apiFormat/models）
//! - API keys：OS keychain（按 Locus bundle ID / exe name 命名空间，跨 app 读不到）
//!
//! v0.1 设计：
//! - 读 Locus config.json（拿 model + base_url）
//! - 读 Locus custom_providers.json（拿完整 provider 列表，**API key 空**）
//! - 返回 LocusImportData 给前端，UI 弹 modal 让玩家挑要导入哪些
//! - 玩家在 PlotCraft 这边手动填 API key（keychain 跨 app 读不到）
//!
//! v0.2+ 升级路径：
//! - PlotCraft 接 OS keychain 后，可以试着用同样的 key name 读 Locus 写入的 key
//!   （但 keychain 通常按 service 命名空间，Locus 写的 key 在 Locus 的 service 下，
//!   PlotCraft 读不到 —— 除非用 macOS keychain / Linux Secret Service 等允许跨 app 读）
//!
//! 不 import Locus 其他 22 字段（Unity / MCP / OAuth / subagent 等 PlotCraft 不用）

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::llm::config::ApiFormat;

/// Locus `config.json` 路径
const LOCUS_CONFIG_DIR: &str = "Locus";
const LOCUS_CONFIG_FILE: &str = "config.json";
const LOCUS_CUSTOM_PROVIDERS_FILE: &str = "custom_providers.json";

/// Locus `CustomProvider` JSON 形状（sub-set，足够 import 用）
///
/// 完整 Locus `CustomProvider` 字段参考 Locus `src/types.ts:611`：
/// `id / name / endpoint / apiFormat / apiKey / catalogId? / models[]`
/// v0.1 只关心：id / name / endpoint / apiFormat / models.length / enabled
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocusCustomProvider {
    pub id: String,
    pub name: String,
    pub endpoint: String,
    #[serde(default = "default_locus_api_format")]
    pub api_format: String, // 字符串，避免 enum 解析失败
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub models: Vec<serde_json::Value>, // 不解析内部结构，只要 length
}

fn default_locus_api_format() -> String {
    "openai_chat".to_string()
}

/// Locus `custom_providers.json` 文件结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocusCustomProvidersFile {
    #[serde(default = "default_locus_version")]
    pub version: u32,
    #[serde(default)]
    pub providers: Vec<LocusCustomProvider>,
}

fn default_locus_version() -> u32 {
    1
}

/// 单个 Locus provider 的 import 数据（前端 UI 展示用）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocusProviderImport {
    pub id: String,
    pub name: String,
    pub endpoint: String,
    pub api_format: ApiFormat,
    pub model_count: usize,
    pub enabled: bool,
    /// v0.1+ 从 Locus models[0].id 取（PlotCraft 简化 per-provider models[]）
    #[serde(rename = "defaultModel")]
    pub default_model: String,
}

/// Locus 导入数据汇总
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocusImportData {
    /// Locus config 是否存在
    pub found: bool,
    /// Locus config.json 路径（前端展示用）
    pub config_path: String,
    /// Locus 自定义 providers 路径（前端展示用）
    pub custom_providers_path: String,
    /// Locus 主 config 的 `model` 字段
    pub model: Option<String>,
    /// Locus 主 config 的 `base_url` 字段
    pub base_url: Option<String>,
    /// 推断的 apiFormat（从 base_url 启发式：含 "anthropic" → anthropic_messages）
    pub inferred_api_format: Option<ApiFormat>,
    /// Locus custom providers（不含 apiKey —— Locus 把 key 存 keychain）
    pub providers: Vec<LocusProviderImport>,
}

fn locus_config_path() -> AppResult<PathBuf> {
    let dir = dirs::config_dir()
        .ok_or_else(|| AppError::Config("could not find config dir".to_string()))?
        .join(LOCUS_CONFIG_DIR);
    Ok(dir.join(LOCUS_CONFIG_FILE))
}

fn locus_custom_providers_path() -> AppResult<PathBuf> {
    let dir = dirs::config_dir()
        .ok_or_else(|| AppError::Config("could not find config dir".to_string()))?
        .join(LOCUS_CONFIG_DIR);
    Ok(dir.join(LOCUS_CUSTOM_PROVIDERS_FILE))
}

/// 从 Locus config 读取（24 Locus 字段，serde 默认可选）
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LocusConfigSubset {
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub base_url: Option<String>,
}

/// Tauri command：读 Locus config + custom_providers.json，返回汇总
#[tauri::command]
pub async fn import_from_locus() -> AppResult<LocusImportData> {
    let config_path = locus_config_path()?;
    let custom_providers_path = locus_custom_providers_path()?;

    // 主 config
    let (model, base_url) = if config_path.exists() {
        let raw = tokio::fs::read_to_string(&config_path)
            .await
            .map_err(|e| AppError::Config(format!("read Locus config: {}", e)))?;
        let parsed: LocusConfigSubset = serde_json::from_str(&raw)
            .map_err(|e| AppError::Config(format!("parse Locus config: {}", e)))?;
        (parsed.model, parsed.base_url)
    } else {
        (None, None)
    };

    // custom_providers.json
    let providers = if custom_providers_path.exists() {
        let raw = tokio::fs::read_to_string(&custom_providers_path)
            .await
            .map_err(|e| AppError::Config(format!("read Locus custom_providers: {}", e)))?;
        let file: LocusCustomProvidersFile = serde_json::from_str(&raw)
            .map_err(|e| AppError::Config(format!("parse Locus custom_providers: {}", e)))?;
        file.providers
            .into_iter()
            .map(|p| {
                // v0.1+ 从 Locus models[0].id 取 defaultModel（PlotCraft 简化了
                // per-provider models[]，用单 model id 代替 Locus 的多 model 列表）
                let default_model = p
                    .models
                    .first()
                    .and_then(|m| m.get("id").and_then(|v| v.as_str()))
                    .unwrap_or("")
                    .to_string();
                LocusProviderImport {
                    id: p.id,
                    name: p.name,
                    endpoint: p.endpoint,
                    api_format: parse_locus_api_format(&p.api_format),
                    model_count: p.models.len(),
                    enabled: p.enabled.unwrap_or(true),
                    default_model,
                }
            })
            .collect()
    } else {
        Vec::new()
    };

    let inferred_api_format = base_url.as_deref().map(infer_api_format);

    Ok(LocusImportData {
        found: config_path.exists() || custom_providers_path.exists(),
        config_path: config_path.display().to_string(),
        custom_providers_path: custom_providers_path.display().to_string(),
        model,
        base_url,
        inferred_api_format,
        providers,
    })
}

/// Locus 的 apiFormat 字符串 → PlotCraft `ApiFormat` enum
///
/// Locus 字符串：`openai_chat` / `openai_responses` / `anthropic_messages`。
/// PlotCraft `ApiFormat` 也是这 3 个。转换失败 → fallback to `OpenaiChat`。
fn parse_locus_api_format(s: &str) -> ApiFormat {
    match s {
        "openai_chat" => ApiFormat::OpenaiChat,
        "openai_responses" => ApiFormat::OpenaiResponses,
        "anthropic_messages" => ApiFormat::AnthropicMessages,
        _ => ApiFormat::OpenaiChat,
    }
}

/// 从 base_url 启发式推断 apiFormat
///
/// - 含 "anthropic" → Anthropic
/// - 其他 → OpenAI Chat（默认最常见）
fn infer_api_format(base_url: &str) -> ApiFormat {
    let lower = base_url.to_lowercase();
    if lower.contains("anthropic") {
        ApiFormat::AnthropicMessages
    } else {
        ApiFormat::OpenaiChat
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_locus_api_format_handles_all_three_variants() {
        assert_eq!(parse_locus_api_format("openai_chat"), ApiFormat::OpenaiChat);
        assert_eq!(
            parse_locus_api_format("openai_responses"),
            ApiFormat::OpenaiResponses
        );
        assert_eq!(
            parse_locus_api_format("anthropic_messages"),
            ApiFormat::AnthropicMessages
        );
        // 未知 fallback
        assert_eq!(parse_locus_api_format("garbage"), ApiFormat::OpenaiChat);
    }

    #[test]
    fn infer_api_format_from_base_url() {
        assert_eq!(
            infer_api_format("https://api.anthropic.com"),
            ApiFormat::AnthropicMessages
        );
        assert_eq!(
            infer_api_format("https://api.openai.com/v1"),
            ApiFormat::OpenaiChat
        );
        assert_eq!(
            infer_api_format("https://api.deepseek.com/v1"),
            ApiFormat::OpenaiChat
        );
        // case-insensitive
        assert_eq!(
            infer_api_format("https://ANTHROPIC.com"),
            ApiFormat::AnthropicMessages
        );
    }

    #[test]
    fn parse_locus_custom_providers_file() {
        let json = r#"{
            "version": 1,
            "providers": [
                {
                    "id": "claude",
                    "name": "Claude (Anthropic)",
                    "endpoint": "https://api.anthropic.com",
                    "apiFormat": "anthropic_messages",
                    "enabled": true,
                    "models": [
                        {"id": "claude-opus-4-1"},
                        {"id": "claude-sonnet-4-5"}
                    ]
                },
                {
                    "id": "openrouter",
                    "name": "OpenRouter",
                    "endpoint": "https://openrouter.ai/api/v1",
                    "apiFormat": "openai_chat",
                    "models": []
                }
            ]
        }"#;
        let file: LocusCustomProvidersFile = serde_json::from_str(json).unwrap();
        assert_eq!(file.providers.len(), 2);
        assert_eq!(file.providers[0].id, "claude");
        assert_eq!(file.providers[0].endpoint, "https://api.anthropic.com");
        assert_eq!(file.providers[0].api_format, "anthropic_messages");
        assert_eq!(file.providers[0].models.len(), 2);
        assert_eq!(file.providers[1].id, "openrouter");
        // 没 enabled 字段 → default None
        assert!(file.providers[1].enabled.is_none());
    }

    /// 模拟用户实际 Locus 数据 shape（UUID id / `openrouter/...` model / null base_url / null enabled）
    #[test]
    fn parse_real_world_locus_data_shape() {
        // 类似用户在 Locus 的实际数据（2026-07-28 抓的）
        let config_json = r#"{
            "model": "openrouter/claude-sonnet-4.6",
            "base_url": null,
            "debug": false,
            "close_behavior": "exit",
            "dynamic_tool_loading_mode": "native"
        }"#;
        let cfg: LocusConfigSubset = serde_json::from_str(config_json).unwrap();
        assert_eq!(cfg.model.as_deref(), Some("openrouter/claude-sonnet-4.6"));
        // base_url: null → None（PlotCraft 不会覆盖）
        assert!(cfg.base_url.is_none());

        // base_url: null 推断 apiFormat → OpenaiChat（default fallback）
        assert_eq!(infer_api_format(""), ApiFormat::OpenaiChat);
        // 实际 base_url null 时根本不调用 infer_api_format
        // （applyImport 检查 if (locusData.value.baseUrl)）

        // UUID-style ids + mixed apiFormats + null enabled
        let custom_json = r#"{
            "version": 2,
            "providers": [
                {
                    "id": "610e7222-42ca-4b3e-90bf-a2fd9c11c73c",
                    "name": "winky-claude-sonnet-5",
                    "endpoint": "https://lumos.diandian.info/winky/claude/v1",
                    "apiFormat": "anthropic_messages",
                    "enabled": null,
                    "models": [{"id": "claude-sonnet-5-20250929"}]
                },
                {
                    "id": "28fad8e1-847f-4fea-952b-abc753914984",
                    "name": "winky-kimi-3",
                    "endpoint": "https://lumos.diandian.info/winky/kimi/v1",
                    "apiFormat": "openai_chat",
                    "enabled": null,
                    "models": [{"id": "kimi-3"}]
                },
                {
                    "id": "be2712b9-e4cd-498d-a448-37fc72bdf981",
                    "name": "winky-gpt-5.6-terra",
                    "endpoint": "https://lumos.diandian.info/winky/openai/v1",
                    "apiFormat": "openai_responses",
                    "enabled": null,
                    "models": [{"id": "gpt-5.6-terra"}]
                },
                {
                    "id": "32275581-23e7-4d52-83ee-c14cc5b7f588",
                    "name": "deepseek",
                    "endpoint": "https://api.deepseek.com/anthropic",
                    "apiFormat": "anthropic_messages",
                    "models": [
                        {"id": "deepseek-chat"},
                        {"id": "deepseek-reasoner"}
                    ]
                },
                {
                    "id": "29d1331a-b785-4c6b-84a9-a532f0a59082",
                    "name": "MiniMax",
                    "endpoint": "https://api.minimaxi.com/v1",
                    "apiFormat": "openai_responses",
                    "enabled": null,
                    "models": [{"id": "MiniMax-Text-01"}]
                },
                {
                    "id": "af814760-953a-4bbe-b2c4-1bbd97886964",
                    "name": "winky-glm",
                    "endpoint": "https://lumos.diandian.info/winky/glm/v1",
                    "apiFormat": "openai_chat",
                    "enabled": null,
                    "models": [{"id": "glm-4.6"}]
                }
            ]
        }"#;
        let file: LocusCustomProvidersFile = serde_json::from_str(custom_json).unwrap();
        assert_eq!(file.version, 2);
        assert_eq!(file.providers.len(), 6);

        // UUID id
        assert_eq!(
            file.providers[0].id,
            "610e7222-42ca-4b3e-90bf-a2fd9c11c73c"
        );
        // 3 种 apiFormat 都解得到
        assert_eq!(file.providers[0].api_format, "anthropic_messages");
        assert_eq!(file.providers[1].api_format, "openai_chat");
        assert_eq!(file.providers[2].api_format, "openai_responses");

        // null enabled → None
        assert!(file.providers[0].enabled.is_none());
        // 没 enabled 字段（deepseek 那条）→ None
        assert!(file.providers[3].enabled.is_none());

        // 各种 model count
        assert_eq!(file.providers[0].models.len(), 1);
        assert_eq!(file.providers[3].models.len(), 2);

        // 模拟 import：所有 provider 都能成功 parse + defaultModel 从 models[0].id 取
        for p in &file.providers {
            let default_model = p
                .models
                .first()
                .and_then(|m| m.get("id").and_then(|v| v.as_str()))
                .unwrap_or("")
                .to_string();
            let import = LocusProviderImport {
                id: p.id.clone(),
                name: p.name.clone(),
                endpoint: p.endpoint.clone(),
                api_format: parse_locus_api_format(&p.api_format),
                model_count: p.models.len(),
                enabled: p.enabled.unwrap_or(true),
                default_model,
            };
            // winky-claude-sonnet-5 → "claude-sonnet-5-20250929"
            if p.name == "winky-claude-sonnet-5" {
                assert_eq!(import.default_model, "claude-sonnet-5-20250929");
            }
            // deepseek → "deepseek-chat"（models[0]）
            if p.name == "deepseek" {
                assert_eq!(import.default_model, "deepseek-chat");
            }
        }
    }

    /// 验证 model 字段含特殊字符（openrouter 路由风格 `provider/model`）能正常通过
    #[test]
    fn model_field_handles_openrouter_routing_style() {
        let cfg: LocusConfigSubset =
            serde_json::from_str(r#"{"model": "openrouter/claude-sonnet-4.6"}"#).unwrap();
        assert_eq!(cfg.model.as_deref(), Some("openrouter/claude-sonnet-4.6"));
    }
}
