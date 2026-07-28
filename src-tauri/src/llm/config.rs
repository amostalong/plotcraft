//! LLM 配置（v0.1 Locus-shape compat）
//!
//! 关键设计：**PlotCraft 的 `config.json` 跟 Locus `config.json` 字面兼容**。
//! - 顶层 24 个字段跟 Locus `AppConfig` 字段名 / 类型 / serde 约定完全一致
//!   （参考 Locus `src-tauri/src/config.rs:280-430` `AppConfig`）
//! - PlotCraft 加 3 个扩展字段（`apiKey` / `ui.theme` / `recentProjects`）——
//!   Locus 看到会自动忽略（serde 默认行为），PlotCraft 看到会用到
//! - 简化：Locus 用 `Arc<AtomicBool>` 跑 hot-reload in-memory，PlotCraft v0.1 不用，
//!   全部用简单类型（`bool` / `String` / `u32`）。JSON 输出完全一致
//! - snake_case 顶层（跟 Locus 一致），nested `codeAnalysisTools` 用 camelCase（跟 Locus 一致）
//!
//! 跟 Locus 关键差异：
//! - PlotCraft v0.1 不接 keychain，API key 裸存 `config.json` 顶层的 `apiKey` 字段
//!   （Locus 走 OS keychain，索引在 `provider_key_ids.json`）
//! - PlotCraft v0.1 不实装 Unity / C# LSP / MCP / OAuth / subagent —— 对应字段
//!   写进 struct 但 `#[serde(default)]`，玩家编辑不了也用不上
//! - 内部 `LlmConfig`（streaming runtime）保持 flat —— 跟 on-disk 形状解耦
//!
//! 数据迁移：老 PlotCraft v0.1 `{providers: {...}, modelDefaults: {...}}` shape
//! 会被 serde 静默忽略（不在 struct 里），玩家手动 re-enter 即可（v0.1 还没真实玩家）

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::error::{AppError, AppResult};

const CONFIG_FILE: &str = "config.json";
const DEFAULT_OPENAI_ENDPOINT: &str = "https://api.openai.com/v1";
const DEFAULT_MODEL: &str = "gpt-4o-mini";
const DEFAULT_THEME: &str = "dark";

// --- 顶层字段 (Locus `AppConfig:280-430` 镜像) ---

/// Locus `AppCloseBehavior` 镜像（`Exit` | `MinimizeToTray`）
///
/// PlotCraft v0.1 不用，但 shape 必须保留（serde 字符串）
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum AppCloseBehavior {
    #[default]
    Exit,
    MinimizeToTray,
}

/// Locus `DynamicToolLoadingMode` 镜像
///
/// PlotCraft v0.1 不用此字段。用 `String` 而非 enum 是因为 Locus 内部 enum 变体未知，
/// PlotCraft 不需要解释（只过 shape 兼容）。Locus 看到 `String` 字段会按它自己的 enum
/// 解析（serde 标准行为）。
pub type DynamicToolLoadingMode = String;

/// Locus `CodeAnalysisToolsConfig` 镜像（camelCase 子字段，参考 Locus `config.rs:209-220`）
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct CodeAnalysisToolsConfig {
    pub code_symbol_search: bool,
    pub code_goto_definition: bool,
    pub code_find_references: bool,
    pub code_diagnostics: bool,
    pub edit_write_diagnostics: bool,
    pub code_hover: bool,
    pub unity_code_usages: bool,
    pub unity_analyzers: bool,
}

/// PlotCraft 扩展：UI 主题（v0.1 只用 dark）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UiConfig {
    #[serde(default = "default_theme")]
    pub theme: String,
}

/// PlotCraft 扩展：第三方 provider 库（saved library，OpenAI 兼容端点）
///
/// Locus 的 `CustomProvider`（参考 Locus `src/types.ts:611`）有完整字段
/// `id` / `name` / `endpoint` / `apiFormat` / `apiKey` / `catalogId` / `models[]`。
/// PlotCraft v0.1 简化（不分 apiFormat、不接 keychain、不按 provider 分 model）：
/// - `id`：唯一 key（小写英文，用于 `providers.openai` 这种 lookup）
/// - `name`：UI 显示名
/// - `base_url`：OpenAI 兼容 endpoint
/// - `api_key`：v0.1 裸存（v0.2 升 keyring）
/// - `enabled`：是否启用（玩家可以暂时 disable 不删除）
///
/// JSON 字段 camelCase（跟 Locus `CustomProvider` 内部一致）。
/// 但 Locus 顶层 `AppConfig` 不带 `custom_providers` 字段 —— PlotCraft 这边
/// 在顶层 `AppConfig` 加 `custom_providers: Vec<CustomProvider>`，
/// Locus 看到会忽略这个 PlotCraft 扩展字段。
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CustomProvider {
    pub id: String,
    pub name: String,
    pub base_url: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

impl Default for UiConfig {
    fn default() -> Self {
        Self {
            theme: DEFAULT_THEME.to_string(),
        }
    }
}

fn default_theme() -> String {
    DEFAULT_THEME.to_string()
}

/// `config.json` 顶层 —— Locus 字段 + PlotCraft 扩展
///
/// 字段顺序跟 Locus 一致，扩展字段放最后。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    // ── Locus 字段（snake_case，参考 Locus `AppConfig:280-430`）──
    pub model: String,
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub debug: bool,
    #[serde(default)]
    pub file_tool_workspace_boundary: bool,
    #[serde(default)]
    pub close_behavior: AppCloseBehavior,
    #[serde(default)]
    pub dynamic_tool_loading_mode: DynamicToolLoadingMode,
    #[serde(default)]
    pub dynamic_tool_loading_native_migrated: bool,
    #[serde(default = "default_true")]
    pub anthropic_native_lazy_enabled: bool,
    #[serde(default)]
    pub default_skill_package_namespace: String,
    #[serde(default)]
    pub view_windows_above_main: bool,
    #[serde(default = "default_true")]
    pub view_open_in_existing_window: bool,
    #[serde(default = "default_true")]
    pub unity_background_hook_enabled: bool,
    #[serde(default = "default_true")]
    pub unity_state_probe_enabled: bool,
    #[serde(default)]
    pub csharp_lsp_enabled: bool,
    #[serde(default = "default_true")]
    pub unity_sidecar_compiler: bool,
    #[serde(default = "default_true")]
    pub unity_in_process_compile_fallback: bool,
    #[serde(default)]
    pub unity_hot_reload: bool,
    #[serde(default = "default_true")]
    pub unity_native_bridge_enabled: bool,
    #[serde(default = "default_true")]
    pub unity_inline_force_evaluate_enabled: bool,
    #[serde(default)]
    pub code_analysis_tools: CodeAnalysisToolsConfig,
    #[serde(default = "default_llm_retry_max_attempts")]
    pub llm_retry_max_attempts: u32,
    #[serde(default = "default_true")]
    pub llm_strip_inline_think_tags: bool,
    #[serde(default = "default_subagent_max_depth")]
    pub subagent_max_depth: u32,
    #[serde(default = "default_subagent_max_concurrent")]
    pub subagent_max_concurrent: u32,

    // ── PlotCraft 扩展字段 ──
    /// API key（v0.1 裸存；v0.2 升 keychain / keyring）
    #[serde(default, rename = "apiKey")]
    pub api_key: String,
    /// UI 配置（PlotCraft 自加；Locus 走 localStorage）
    #[serde(default)]
    pub ui: UiConfig,
    /// 最近打开的项目路径（PlotCraft 自加；Locus 走 session-based tracking）
    #[serde(default, rename = "recentProjects")]
    pub recent_projects: Vec<String>,
    /// 已保存的第三方 provider 库（PlotCraft 自加；Locus 走 keychain + `provider_key_ids.json`）
    #[serde(default, rename = "customProviders")]
    pub custom_providers: Vec<CustomProvider>,
}

fn default_true() -> bool {
    true
}
fn default_llm_retry_max_attempts() -> u32 {
    3
}
fn default_subagent_max_depth() -> u32 {
    1
}
fn default_subagent_max_concurrent() -> u32 {
    3
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            model: DEFAULT_MODEL.to_string(),
            base_url: Some(DEFAULT_OPENAI_ENDPOINT.to_string()),
            debug: false,
            file_tool_workspace_boundary: false,
            close_behavior: AppCloseBehavior::default(),
            dynamic_tool_loading_mode: String::new(),
            dynamic_tool_loading_native_migrated: true,
            anthropic_native_lazy_enabled: true,
            default_skill_package_namespace: String::new(),
            view_windows_above_main: false,
            view_open_in_existing_window: true,
            unity_background_hook_enabled: true,
            unity_state_probe_enabled: true,
            csharp_lsp_enabled: false,
            unity_sidecar_compiler: true,
            unity_in_process_compile_fallback: true,
            unity_hot_reload: false,
            unity_native_bridge_enabled: true,
            unity_inline_force_evaluate_enabled: true,
            code_analysis_tools: CodeAnalysisToolsConfig::default(),
            llm_retry_max_attempts: 3,
            llm_strip_inline_think_tags: true,
            subagent_max_depth: 1,
            subagent_max_concurrent: 3,
            api_key: String::new(),
            ui: UiConfig::default(),
            recent_projects: Vec::new(),
            custom_providers: Vec::new(),
        }
    }
}

impl AppConfig {
    /// `config.json` 绝对路径（`%APPDATA%/PlotCraft/config.json` on Windows）
    pub fn config_path(app: &tauri::AppHandle) -> AppResult<PathBuf> {
        let dir = app
            .path()
            .app_config_dir()
            .map_err(|e| AppError::Config(format!("app_config_dir: {}", e)))?;
        Ok(dir.join(CONFIG_FILE))
    }

    /// 读 config.json → 解析 → 返回 `AppConfig`
    /// 缺文件 / 解析失败 → 返回 `AppConfig::default()`（v0.1 简化）
    pub fn from_app_config(app: &tauri::AppHandle) -> AppResult<Self> {
        let path = Self::config_path(app)?;
        if !path.exists() {
            return Ok(Self::default());
        }
        let raw = std::fs::read_to_string(&path)
            .map_err(|e| AppError::Config(format!("read {}: {}", path.display(), e)))?;
        let config: AppConfig = serde_json::from_str(&raw)
            .map_err(|e| AppError::Config(format!("invalid JSON: {}", e)))?;
        Ok(config)
    }
}

/// 内部 flat `LlmConfig` —— streaming runtime 用
///
/// v0.1：从 `AppConfig` 顶层 `model` / `base_url` / `api_key` 解出
/// v0.2+：多 provider 时再加 `provider` 字段
#[derive(Debug, Clone)]
pub struct LlmConfig {
    pub endpoint: String,
    pub api_key: String,
    pub model: String,
}

impl LlmConfig {
    /// 从 `AppConfig` 解出 v0.1 flat `LlmConfig`
    ///
    /// - `base_url` 为空 / `None` → 用 default OpenAI endpoint
    /// - `model` 为空 → 用 default `gpt-4o-mini`
    pub fn from_app_config(app: &tauri::AppHandle) -> AppResult<Self> {
        let cfg = AppConfig::from_app_config(app)?;
        let endpoint = cfg
            .base_url
            .clone()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| DEFAULT_OPENAI_ENDPOINT.to_string());
        let model = if cfg.model.is_empty() {
            DEFAULT_MODEL.to_string()
        } else {
            cfg.model
        };
        Ok(Self {
            endpoint,
            api_key: cfg.api_key,
            model,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config_has_openai_endpoint_and_gpt4o_mini() {
        let cfg = AppConfig::default();
        assert_eq!(cfg.model, "gpt-4o-mini");
        assert_eq!(
            cfg.base_url.as_deref(),
            Some("https://api.openai.com/v1")
        );
        assert!(cfg.api_key.is_empty());
        assert_eq!(cfg.ui.theme, "dark");
        assert!(cfg.recent_projects.is_empty());
    }

    #[test]
    fn serde_roundtrip_preserves_locus_shape() {
        // 写出来再读回去，shape 一致
        let cfg = AppConfig::default();
        let json = serde_json::to_string_pretty(&cfg).unwrap();
        let parsed: AppConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.model, cfg.model);
        assert_eq!(parsed.base_url, cfg.base_url);
        assert_eq!(parsed.debug, cfg.debug);
        assert_eq!(parsed.close_behavior, cfg.close_behavior);
        assert_eq!(parsed.code_analysis_tools, cfg.code_analysis_tools);
        assert_eq!(parsed.api_key, cfg.api_key);
        assert_eq!(parsed.ui.theme, cfg.ui.theme);
    }

    #[test]
    fn can_read_locus_written_config() {
        // 模拟 Locus 写的 config.json（PlotCraft 扩展字段不存在）
        // Locus 顶层字段 snake_case（参考 Locus `AppConfig:280-430`），nested
        // `codeAnalysisTools` 是 camelCase（参考 Locus `config.rs:210`）
        let locus_json = r#"{
            "model": "openrouter/claude-opus-4.8",
            "base_url": "https://openrouter.ai/api/v1",
            "debug": false,
            "file_tool_workspace_boundary": false,
            "close_behavior": "exit",
            "dynamic_tool_loading_mode": "native",
            "dynamic_tool_loading_native_migrated": true,
            "anthropic_native_lazy_enabled": true,
            "default_skill_package_namespace": "",
            "view_windows_above_main": false,
            "view_open_in_existing_window": true,
            "unity_background_hook_enabled": true,
            "unity_state_probe_enabled": true,
            "csharp_lsp_enabled": false,
            "unity_sidecar_compiler": true,
            "unity_in_process_compile_fallback": true,
            "unity_hot_reload": false,
            "unity_native_bridge_enabled": true,
            "unity_inline_force_evaluate_enabled": true,
            "code_analysis_tools": {
                "codeSymbolSearch": true,
                "codeGotoDefinition": true,
                "codeFindReferences": true,
                "codeDiagnostics": false,
                "editWriteDiagnostics": true,
                "codeHover": false,
                "unityCodeUsages": true,
                "unityAnalyzers": true
            },
            "llm_retry_max_attempts": 3,
            "llm_strip_inline_think_tags": true,
            "subagent_max_depth": 1,
            "subagent_max_concurrent": 3
        }"#;
        let cfg: AppConfig = serde_json::from_str(locus_json).unwrap();
        assert_eq!(cfg.model, "openrouter/claude-opus-4.8");
        assert_eq!(cfg.base_url.as_deref(), Some("https://openrouter.ai/api/v1"));
        assert_eq!(cfg.close_behavior, AppCloseBehavior::Exit);
        assert_eq!(cfg.code_analysis_tools.code_symbol_search, true);
        assert!(cfg.api_key.is_empty()); // Locus 不写 apiKey，PlotCraft 用 default
        assert_eq!(cfg.ui.theme, "dark"); // PlotCraft 扩展字段 default
    }

    #[test]
    fn plotcraft_writes_api_key_at_top_level() {
        // PlotCraft 写 config.json 时，apiKey 出现在顶层
        let mut cfg = AppConfig::default();
        cfg.api_key = "sk-test-123".to_string();
        let json = serde_json::to_string(&cfg).unwrap();
        assert!(json.contains("\"apiKey\":\"sk-test-123\""));
    }

    #[test]
    fn llm_config_uses_default_when_empty() {
        // 模拟 AppConfig 里 model 和 base_url 都是空（玩家第一次启动没改）
        let mut cfg = AppConfig::default();
        cfg.model = String::new();
        cfg.base_url = None;

        // 验证 LlmConfig 解出 default（不能直接测 from_app_config 因为要走 Tauri AppHandle）
        let endpoint = cfg
            .base_url
            .clone()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| DEFAULT_OPENAI_ENDPOINT.to_string());
        let model = if cfg.model.is_empty() {
            DEFAULT_MODEL.to_string()
        } else {
            cfg.model
        };
        assert_eq!(endpoint, DEFAULT_OPENAI_ENDPOINT);
        assert_eq!(model, DEFAULT_MODEL);
    }

    #[test]
    fn custom_providers_roundtrip() {
        let mut cfg = AppConfig::default();
        cfg.custom_providers = vec![
            CustomProvider {
                id: "deepseek".to_string(),
                name: "DeepSeek".to_string(),
                base_url: "https://api.deepseek.com/v1".to_string(),
                api_key: "sk-deepseek-test".to_string(),
                enabled: true,
            },
            CustomProvider {
                id: "openrouter".to_string(),
                name: "OpenRouter".to_string(),
                base_url: "https://openrouter.ai/api/v1".to_string(),
                api_key: "sk-or-test".to_string(),
                enabled: true,
            },
            CustomProvider {
                id: "disabled-one".to_string(),
                name: "Disabled Provider".to_string(),
                base_url: "https://example.com/v1".to_string(),
                api_key: "".to_string(),
                enabled: false,
            },
        ];

        let json = serde_json::to_string_pretty(&cfg).unwrap();
        // 验证 camelCase JSON 输出（跟 Locus CustomProvider 内部一致）
        assert!(json.contains("\"customProviders\""));
        // CustomProvider 内部字段 camelCase
        assert!(json.contains("\"baseUrl\":"));
        assert!(json.contains("\"apiKey\":"));
        assert!(json.contains("\"deepseek\""));
        assert!(json.contains("\"openrouter\""));
        // 顶层 AppConfig 字段是 snake_case（base_url / model），跟 Locus 一致
        assert!(json.contains("\"base_url\":"));
        assert!(json.contains("\"model\":"));
        // 顶层 PlotCraft 扩展（apiKey / customProviders）必须 camelCase
        assert!(json.contains("\"apiKey\":"));
        assert!(!json.contains("\"custom_providers\""));

        let parsed: AppConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.custom_providers.len(), 3);
        assert_eq!(parsed.custom_providers[0].id, "deepseek");
        assert_eq!(parsed.custom_providers[0].name, "DeepSeek");
        assert_eq!(
            parsed.custom_providers[0].base_url,
            "https://api.deepseek.com/v1"
        );
        assert_eq!(parsed.custom_providers[0].api_key, "sk-deepseek-test");
        assert!(parsed.custom_providers[0].enabled);
        assert!(!parsed.custom_providers[2].enabled);
    }

    #[test]
    fn can_read_config_with_locus_fields_plus_plotcraft_custom_providers() {
        // Locus 顶层字段 + PlotCraft custom_providers 同时存在
        // （模拟两个 app 的 config 都跑到同一个文件，或者 migrate 场景）
        let json = r#"{
            "model": "gpt-4o-mini",
            "base_url": "https://api.openai.com/v1",
            "debug": false,
            "file_tool_workspace_boundary": false,
            "close_behavior": "exit",
            "dynamic_tool_loading_mode": "",
            "dynamic_tool_loading_native_migrated": true,
            "anthropic_native_lazy_enabled": true,
            "default_skill_package_namespace": "",
            "view_windows_above_main": false,
            "view_open_in_existing_window": true,
            "unity_background_hook_enabled": true,
            "unity_state_probe_enabled": true,
            "csharp_lsp_enabled": false,
            "unity_sidecar_compiler": true,
            "unity_in_process_compile_fallback": true,
            "unity_hot_reload": false,
            "unity_native_bridge_enabled": true,
            "unity_inline_force_evaluate_enabled": true,
            "code_analysis_tools": {
                "codeSymbolSearch": true,
                "codeGotoDefinition": true,
                "codeFindReferences": true,
                "codeDiagnostics": false,
                "editWriteDiagnostics": true,
                "codeHover": false,
                "unityCodeUsages": true,
                "unityAnalyzers": true
            },
            "llm_retry_max_attempts": 3,
            "llm_strip_inline_think_tags": true,
            "subagent_max_depth": 1,
            "subagent_max_concurrent": 3,
            "apiKey": "sk-main",
            "ui": { "theme": "dark" },
            "recentProjects": ["/path/to/proj1"],
            "customProviders": [
                {
                    "id": "deepseek",
                    "name": "DeepSeek",
                    "baseUrl": "https://api.deepseek.com/v1",
                    "apiKey": "sk-deepseek",
                    "enabled": true
                }
            ]
        }"#;
        let cfg: AppConfig = serde_json::from_str(json).unwrap();
        assert_eq!(cfg.model, "gpt-4o-mini");
        assert_eq!(cfg.api_key, "sk-main");
        assert_eq!(cfg.recent_projects, vec!["/path/to/proj1"]);
        assert_eq!(cfg.custom_providers.len(), 1);
        assert_eq!(cfg.custom_providers[0].id, "deepseek");
        assert_eq!(
            cfg.custom_providers[0].base_url,
            "https://api.deepseek.com/v1"
        );
    }
}
