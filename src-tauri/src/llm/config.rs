//! LLM 配置（v0.1 Locus-shape subset）
//!
//! On-disk 形状（`%APPDATA%/PlotCraft/config.json`）跟 Locus 对齐：
//! - `providers`: 多 provider dict（v0.1 只实装 `openai`，其他 v0.2+）
//! - `modelDefaults`: 主模型 / 计划模型 / subagent 模型（v0.1 只 mainModel）
//! - `modelCatalog`: 远端模型目录（v0.1 始终 `None`，玩家手填模型名）
//! - `ui`: 主题等
//! - `recentProjects`: 最近项目路径
//!
//! 内部 `LlmConfig`（streaming runtime 用）保持 flat —— 那是 runtime 形状，
//! 不应该被 on-disk 形状污染。`from_app_config` 负责从 on-disk 形状解出 flat `LlmConfig`。
//!
//! 设计参考 Locus（`C:\Users\dd\Documents\QxLocusProject\Locus\src-tauri\src\config.rs`），
//! 但只取 v0.1 实际需要的部分，**不**直接 import / 复制 Locus 代码
//! （AGENTS.md 硬规则 — 仅结构对齐）。

use std::collections::BTreeMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::error::{AppError, AppResult};

const CONFIG_FILE: &str = "config.json";
const DEFAULT_OPENAI_ENDPOINT: &str = "https://api.openai.com/v1";
const DEFAULT_MAIN_MODEL: &str = "gpt-4o-mini";
const DEFAULT_THEME: &str = "dark";

/// 单个 provider 的 LLM 配置
///
/// JSON 字段名走 camelCase（`apiKey` / `endpoint` / `enabled`）
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfig {
    pub endpoint: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

fn default_true() -> bool {
    true
}

/// 模型默认值
///
/// v0.1 只有 `mainModel`。v0.2+ 加 `planModel` / `subagentModels` / `claudeCodeEnabled`
/// （参考 Locus `ModelDefaults`）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelDefaults {
    #[serde(default)]
    pub main_model: String,
}

impl Default for ModelDefaults {
    fn default() -> Self {
        Self {
            main_model: DEFAULT_MAIN_MODEL.to_string(),
        }
    }
}

/// 远端模型目录（v0.1 始终 `None`）
///
/// v0.2+ 从远端 fetch + snapshot 缓存（参考 Locus `ModelCatalogResponse`）。
/// schema 留位以避免 v0.2 迁移。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ModelCatalog {
    pub source: Option<String>,
    pub fetched_at: Option<String>,
}

/// UI 配置
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UiConfig {
    #[serde(default)]
    pub theme: String,
}

impl Default for UiConfig {
    fn default() -> Self {
        Self {
            theme: DEFAULT_THEME.to_string(),
        }
    }
}

/// 整个 `config.json` 的 on-disk 形状
///
/// 跟 Locus `Config` 同构思路（Locus 字段 100+，PlotCraft v0.1 砍到 ~6 段）。
/// v0.2+ 加字段时**追加**，不改老字段 key —— 避免破坏玩家 config.json。
///
/// 字段顺序跟 JSON 输出一致：`version / providers / modelDefaults / modelCatalog / ui / recentProjects`
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    #[serde(default = "default_version")]
    pub version: u32,
    #[serde(default)]
    pub providers: BTreeMap<String, ProviderConfig>,
    #[serde(default)]
    pub model_defaults: ModelDefaults,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_catalog: Option<ModelCatalog>,
    #[serde(default)]
    pub ui: UiConfig,
    #[serde(default)]
    pub recent_projects: Vec<String>,
}

fn default_version() -> u32 {
    1
}

impl Default for AppConfig {
    fn default() -> Self {
        let mut providers = BTreeMap::new();
        providers.insert(
            "openai".to_string(),
            ProviderConfig {
                endpoint: DEFAULT_OPENAI_ENDPOINT.to_string(),
                api_key: String::new(),
                enabled: true,
            },
        );
        Self {
            version: 1,
            providers,
            model_defaults: ModelDefaults::default(),
            model_catalog: None,
            ui: UiConfig::default(),
            recent_projects: Vec::new(),
        }
    }
}

impl AppConfig {
    /// config.json 绝对路径（`%APPDATA%/PlotCraft/config.json` on Windows）
    pub fn config_path(app: &tauri::AppHandle) -> AppResult<PathBuf> {
        let dir = app
            .path()
            .app_config_dir()
            .map_err(|e| AppError::Config(format!("app_config_dir: {}", e)))?;
        Ok(dir.join(CONFIG_FILE))
    }

    /// 读 config.json → 解析 → 返回 `AppConfig`。
    /// 缺文件 / 解析失败 → 返回 `AppConfig::default()`（v0.1 简化：玩家不感知）。
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
/// 跟 on-disk `AppConfig` 解耦：`from_app_config` 拿 active provider 解出这个。
/// v0.1 active provider = `openai`（hardcoded）；v0.2+ 加 provider 切换 UI 时再加 `provider` 字段。
#[derive(Debug, Clone)]
pub struct LlmConfig {
    pub endpoint: String,
    pub api_key: String,
    pub model: String,
}

impl LlmConfig {
    /// 从 `AppConfig` 解出 v0.1 active provider（`openai`）的 flat `LlmConfig`
    ///
    /// - provider 不存在 → 报错（`Config("provider 'openai' not configured")`）
    /// - provider 存在但 `enabled = false` → 仍返回（玩家主动 disable，但保留配置）
    pub fn from_app_config(app: &tauri::AppHandle) -> AppResult<Self> {
        let cfg = AppConfig::from_app_config(app)?;
        let provider = cfg
            .providers
            .get("openai")
            .ok_or_else(|| AppError::Config("provider 'openai' not configured".to_string()))?;
        Ok(Self {
            endpoint: provider.endpoint.clone(),
            api_key: provider.api_key.clone(),
            model: cfg.model_defaults.main_model.clone(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config_has_openai_provider() {
        let cfg = AppConfig::default();
        assert_eq!(cfg.version, 1);
        assert!(cfg.providers.contains_key("openai"));
        let openai = &cfg.providers["openai"];
        assert_eq!(openai.endpoint, DEFAULT_OPENAI_ENDPOINT);
        assert_eq!(openai.api_key, "");
        assert!(openai.enabled);
        assert_eq!(cfg.model_defaults.main_model, DEFAULT_MAIN_MODEL);
        assert!(cfg.model_catalog.is_none());
        assert_eq!(cfg.ui.theme, "dark");
        assert!(cfg.recent_projects.is_empty());
    }

    #[test]
    fn default_config_json_has_camelcase_keys() {
        let cfg = AppConfig::default();
        let json = serde_json::to_string(&cfg).unwrap();
        // camelCase 输出
        assert!(json.contains("modelDefaults"));
        assert!(json.contains("mainModel"));
        assert!(json.contains("recentProjects"));
        // snake_case 不应出现
        assert!(!json.contains("model_defaults"));
        assert!(!json.contains("main_model"));
    }

    #[test]
    fn deserialize_legacy_flat_llm_field_is_ignored() {
        // 玩家从老 v0.1 schema 升上来 → 老 `llm` 字段被忽略，新字段用 default
        let raw = r#"{
            "version": 1,
            "llm": {
                "endpoint": "https://old.api/v1",
                "apiKey": "sk-old",
                "model": "gpt-3.5"
            }
        }"#;
        let cfg: AppConfig = serde_json::from_str(raw).unwrap();
        // 老字段被 serde 忽略（不报错，因为不在 struct 里）
        assert!(cfg.providers.is_empty());
        assert_eq!(cfg.model_defaults.main_model, DEFAULT_MAIN_MODEL);
    }

    #[test]
    fn llm_config_uses_openai_provider() {
        let mut cfg = AppConfig::default();
        cfg.providers.get_mut("openai").unwrap().api_key = "sk-test".to_string();
        cfg.providers.get_mut("openai").unwrap().endpoint =
            "https://custom.api/v1".to_string();
        cfg.model_defaults.main_model = "gpt-4o".to_string();

        // 验证 BTreeMap 反序列化能正确读回
        let json = serde_json::to_string(&cfg).unwrap();
        let parsed: AppConfig = serde_json::from_str(&json).unwrap();

        let openai = parsed.providers.get("openai").unwrap();
        assert_eq!(openai.api_key, "sk-test");
        assert_eq!(openai.endpoint, "https://custom.api/v1");
        assert_eq!(parsed.model_defaults.main_model, "gpt-4o");
    }
}
