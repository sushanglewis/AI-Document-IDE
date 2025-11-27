# Copyright (c) 2025 ByteDance Ltd. and/or its affiliates
# SPDX-License-Identifier: MIT

import os
from dataclasses import dataclass, field

import yaml

from trae_agent.utils.context import config_file_var
from trae_agent.utils.legacy_config import LegacyConfig


class ConfigError(Exception):
    pass


@dataclass
class ModelProvider:
    """
    Model provider configuration. For official model providers such as OpenAI and Anthropic,
    the base_url is optional. api_version is required for Azure.
    """

    api_key: str
    provider: str
    base_url: str | None = None
    api_version: str | None = None


@dataclass
class ModelConfig:
    """
    Model configuration.
    """

    model: str
    model_provider: ModelProvider
    temperature: float
    top_p: float
    top_k: int
    parallel_tool_calls: bool
    max_retries: int
    max_tokens: int | None = None  # Legacy max_tokens parameter, optional
    supports_tool_calling: bool = True
    candidate_count: int | None = None  # Gemini specific field
    stop_sequences: list[str] | None = None
    max_completion_tokens: int | None = None  # Azure OpenAI specific field

    def get_max_tokens_param(self) -> int:
        """Get the maximum tokens parameter value.Prioritizes max_completion_tokens, falls back to max_tokens if not available."""
        if self.max_completion_tokens is not None:
            return self.max_completion_tokens
        elif self.max_tokens is not None:
            return self.max_tokens
        else:
            # Return default value if neither is set
            return 4096

    def should_use_max_completion_tokens(self) -> bool:
        """Determine whether to use the max_completion_tokens parameter.Primarily used for Azure OpenAI's newer models (e.g., gpt-5)."""
        return (
            self.max_completion_tokens is not None
            and self.model_provider.provider == "azure"
            and ("gpt-5" in self.model or "o3" in self.model or "o4-mini" in self.model)
        )

    def resolve_config_values(
        self,
        *,
        model_providers: dict[str, ModelProvider] | None = None,
        provider: str | None = None,
        model: str | None = None,
        model_base_url: str | None = None,
        api_key: str | None = None,
    ):
        """
        When some config values are provided through CLI or environment variables,
        they will override the values in the config file.
        """
        self.model = str(resolve_config_value(cli_value=model, config_value=self.model))

        # If the user wants to change the model provider, they should either:
        # * Make sure the provider name is available in the model_providers dict;
        # * If not, base url and api key should be provided to register a new model provider.
        if provider:
            if model_providers and provider in model_providers:
                self.model_provider = model_providers[provider]
            else:
                env_api_key = os.getenv(str(provider).upper() + "_API_KEY")
                env_base_url = os.getenv(str(provider).upper() + "_BASE_URL")
                inferred_api_key = api_key if api_key is not None else env_api_key
                inferred_base_url = model_base_url if model_base_url is not None else env_base_url
                if inferred_api_key is None and (inferred_base_url is None or inferred_base_url == ""):
                    raise ConfigError("To register a new model provider, an api_key should be provided")
                self.model_provider = ModelProvider(
                    api_key=str(inferred_api_key or ""),
                    provider=provider,
                    base_url=inferred_base_url,
                )

        # Map providers to their environment variable names
        env_var_api_key = str(self.model_provider.provider).upper() + "_API_KEY"
        env_var_api_base_url = str(self.model_provider.provider).upper() + "_BASE_URL"

        resolved_api_key = resolve_config_value(
            cli_value=api_key,
            config_value=self.model_provider.api_key,
            env_var=env_var_api_key,
        )

        resolved_api_base_url = resolve_config_value(
            cli_value=model_base_url,
            config_value=self.model_provider.base_url,
            env_var=env_var_api_base_url,
        )

        if resolved_api_key:
            self.model_provider.api_key = str(resolved_api_key)

        if resolved_api_base_url:
            self.model_provider.base_url = str(resolved_api_base_url)


@dataclass
class MCPServerConfig:
    # For stdio transport
    command: str | None = None
    args: list[str] | None = None
    env: dict[str, str] | None = None
    cwd: str | None = None

    # For sse transport
    url: str | None = None

    # For streamable http transport
    http_url: str | None = None
    headers: dict[str, str] | None = None

    # For websocket transport
    tcp: str | None = None

    # Common
    timeout: int | None = None
    trust: bool | None = None

    # Metadata
    description: str | None = None


@dataclass
class AgentConfig:
    """
    Base class for agent configurations.
    """

    allow_mcp_servers: list[str]
    mcp_servers_config: dict[str, MCPServerConfig]
    max_steps: int
    model: ModelConfig
    tools: list[str]


@dataclass
class TraeAgentConfig(AgentConfig):
    """
    Trae agent configuration.
    """

    enable_lakeview: bool = True
    tools: list[str] = field(
        default_factory=lambda: [
            "bash",
            "str_replace_based_edit_tool",
            "sequentialthinking",
            "task_done",
        ]
    )

    def resolve_config_values(
        self,
        *,
        max_steps: int | None = None,
    ):
        resolved_value = resolve_config_value(cli_value=max_steps, config_value=self.max_steps)
        if resolved_value:
            self.max_steps = int(resolved_value)


@dataclass
class LakeviewConfig:
    """
    Lakeview configuration.
    """

    model: ModelConfig


@dataclass
class Config:
    """
    Configuration class for agents, models and model providers.
    """

    lakeview: LakeviewConfig | None = None
    model_providers: dict[str, ModelProvider] | None = None
    models: dict[str, ModelConfig] | None = None

    trae_agent: TraeAgentConfig | None = None

    @classmethod
    def create(
        cls,
        *,
        config_file: str | None = None,
        config_string: str | None = None,
    ) -> "Config":
        if config_file and config_string:
            raise ConfigError("Only one of config_file or config_string should be provided")

        if config_file is None and config_string is None:
            config_file = config_file_var.get() or os.environ.get("TRAE_CONFIG_FILE")

        # Parse YAML config from file or string, or build a minimal default when missing
        try:
            if config_file is not None:
                if config_file.endswith(".json"):
                    return cls.create_from_legacy_config(config_file=config_file)
                with open(config_file, "r") as f:
                    yaml_config = yaml.safe_load(f)
            elif config_string is not None:
                yaml_config = yaml.safe_load(config_string)
            else:
                prov = (os.environ.get("DEFAULT_PROVIDER") or "openrouter").lower()
                model_name = os.environ.get("DEFAULT_MODEL") or "Qwen3-32B"
                base_url = os.environ.get(prov.upper() + "_BASE_URL")
                api_key = os.environ.get(prov.upper() + "_API_KEY") or ""
                yaml_config = {
                    "model_providers": {
                        prov: {
                            "api_key": api_key,
                            "provider": prov,
                            "base_url": base_url,
                            "api_version": None,
                        }
                    },
                    "models": {
                        "default_model": {
                            "model": model_name,
                            "model_provider": prov,
                            "temperature": 0.5,
                            "top_p": 1.0,
                            "top_k": 0,
                            "parallel_tool_calls": True,
                            "max_retries": 1,
                            "max_tokens": 4096,
                            "supports_tool_calling": True,
                        }
                    },
                    "agents": {
                        "trae_agent": {
                            "max_steps": 50,
                            "model": "default_model",
                            "tools": [
                                "bash",
                                "str_replace_based_edit_tool",
                                "sequentialthinking",
                                "task_done",
                            ],
                            "enable_lakeview": True,
                        }
                    },
                    "lakeview": {"model": "default_model"},
                    "allow_mcp_servers": [],
                    "mcp_servers": {},
                }
        except yaml.YAMLError as e:
            raise ConfigError(f"Error parsing YAML config: {e}") from e

        config = cls()

        # Parse model providers (allow empty; will be overridden by request parameters if provided)
        model_providers = yaml_config.get("model_providers", None)
        config_model_providers: dict[str, ModelProvider] = {}
        if model_providers is not None and len(model_providers.keys()) > 0:
            for model_provider_name, model_provider_config in model_providers.items():
                config_model_providers[model_provider_name] = ModelProvider(**model_provider_config)
        config.model_providers = config_model_providers

        # Parse models and populate model_provider fields (allow empty; create placeholder)
        models = yaml_config.get("models", None)
        config_models: dict[str, ModelConfig] = {}
        if models is not None and len(models.keys()) > 0:
            for model_name, model_config in models.items():
                provider_name = model_config.get("model_provider")
                provider_obj = (
                    config_model_providers.get(provider_name)
                    if provider_name in config_model_providers
                    else ModelProvider(api_key="", provider=str(provider_name or "openrouter"), base_url=None)
                )
                mc = ModelConfig(**model_config)
                mc.model_provider = provider_obj
                config_models[model_name] = mc
            config.models = config_models
        else:
            # Create a default placeholder model; values will be overridden by request params
            default_provider = ModelProvider(api_key="", provider="openrouter", base_url=None)
            default_model = ModelConfig(
                model="Qwen3-32B",
                model_provider=default_provider,
                temperature=0.5,
                top_p=1.0,
                top_k=0,
                parallel_tool_calls=True,
                max_retries=1,
                max_tokens=4096,
            )
            config_models = {"default_model": default_model}
            config.models = config_models

        # Parse lakeview config
        lakeview = yaml_config.get("lakeview", None)
        if lakeview is not None:
            lakeview_model_name = lakeview.get("model", None)
            lakeview_model = (
                config_models.get(lakeview_model_name)
                if lakeview_model_name in config_models
                else next(iter(config_models.values()))
            )
            config.lakeview = LakeviewConfig(model=lakeview_model)
        else:
            config.lakeview = None

        mcp_servers_config = {
            k: MCPServerConfig(**v) for k, v in yaml_config.get("mcp_servers", {}).items()
        }
        allow_mcp_servers = yaml_config.get("allow_mcp_servers", [])

        # Parse agents
        agents = yaml_config.get("agents", None)
        if agents is not None and len(agents.keys()) > 0:
            for agent_name, agent_config in agents.items():
                agent_model_name = agent_config.get("model", None)
                agent_model = (
                    config_models.get(agent_model_name)
                    if agent_model_name in config_models
                    else next(iter(config_models.values()))
                )
                match agent_name:
                    case "trae_agent":
                        trae_agent_config = TraeAgentConfig(
                            **agent_config,
                            mcp_servers_config=mcp_servers_config,
                            allow_mcp_servers=allow_mcp_servers,
                        )
                        trae_agent_config.model = agent_model
                        if trae_agent_config.enable_lakeview and config.lakeview is None:
                            config.lakeview = LakeviewConfig(model=agent_model)
                        config.trae_agent = trae_agent_config
                    case _:
                        raise ConfigError(f"Unknown agent: {agent_name}")
        else:
            default_model_name = (
                "trae_agent_model" if "trae_agent_model" in config_models else next(iter(config_models.keys()))
            )
            trae_agent_config = TraeAgentConfig(
                max_steps=200,
                enable_lakeview=bool(config.lakeview),
                model=config_models[default_model_name],
                allow_mcp_servers=allow_mcp_servers,
                mcp_servers_config=mcp_servers_config,
            )
            config.trae_agent = trae_agent_config
        return config

    def resolve_config_values(
        self,
        *,
        provider: str | None = None,
        model: str | None = None,
        model_base_url: str | None = None,
        api_key: str | None = None,
        max_steps: int | None = None,
    ):
        if self.trae_agent:
            self.trae_agent.resolve_config_values(
                max_steps=max_steps,
            )
            self.trae_agent.model.resolve_config_values(
                model_providers=self.model_providers,
                provider=provider,
                model=model,
                model_base_url=model_base_url,
                api_key=api_key,
            )
        return self

    @classmethod
    def create_from_legacy_config(
        cls,
        *,
        legacy_config: LegacyConfig | None = None,
        config_file: str | None = None,
    ) -> "Config":
        if legacy_config and config_file:
            raise ConfigError("Only one of legacy_config or config_file should be provided")

        if config_file:
            legacy_config = LegacyConfig(config_file)
        elif not legacy_config:
            raise ConfigError("No legacy_config or config_file provided")

        model_provider = ModelProvider(
            api_key=legacy_config.model_providers[legacy_config.default_provider].api_key,
            base_url=legacy_config.model_providers[legacy_config.default_provider].base_url,
            api_version=legacy_config.model_providers[legacy_config.default_provider].api_version,
            provider=legacy_config.default_provider,
        )

        model_config = ModelConfig(
            model=legacy_config.model_providers[legacy_config.default_provider].model,
            model_provider=model_provider,
            max_tokens=legacy_config.model_providers[legacy_config.default_provider].max_tokens,
            temperature=legacy_config.model_providers[legacy_config.default_provider].temperature,
            top_p=legacy_config.model_providers[legacy_config.default_provider].top_p,
            top_k=legacy_config.model_providers[legacy_config.default_provider].top_k,
            parallel_tool_calls=legacy_config.model_providers[
                legacy_config.default_provider
            ].parallel_tool_calls,
            max_retries=legacy_config.model_providers[legacy_config.default_provider].max_retries,
            candidate_count=legacy_config.model_providers[
                legacy_config.default_provider
            ].candidate_count,
            stop_sequences=legacy_config.model_providers[
                legacy_config.default_provider
            ].stop_sequences,
        )
        mcp_servers_config = {
            k: MCPServerConfig(**vars(v)) for k, v in legacy_config.mcp_servers.items()
        }
        trae_agent_config = TraeAgentConfig(
            max_steps=legacy_config.max_steps,
            enable_lakeview=legacy_config.enable_lakeview,
            model=model_config,
            allow_mcp_servers=legacy_config.allow_mcp_servers,
            mcp_servers_config=mcp_servers_config,
        )

        if trae_agent_config.enable_lakeview:
            lakeview_config = LakeviewConfig(
                model=model_config,
            )
        else:
            lakeview_config = None

        return cls(
            trae_agent=trae_agent_config,
            lakeview=lakeview_config,
            model_providers={
                legacy_config.default_provider: model_provider,
            },
            models={
                "default_model": model_config,
            },
        )


def resolve_config_value(
    *,
    cli_value: int | str | float | None,
    config_value: int | str | float | None,
    env_var: str | None = None,
) -> int | str | float | None:
    """Resolve configuration value with priority: CLI > ENV > Config > Default."""
    if cli_value is not None:
        return cli_value

    if env_var and os.getenv(env_var):
        return os.getenv(env_var)

    if config_value is not None:
        return config_value

    return None
