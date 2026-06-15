/**
 * LLM 大模型答题器 — 类型定义
 *
 * ═══════════════════════════════════════════════════════════
 * 这个模块顶替了原本的「题库搜题」体系：
 *
 *   原本: 题目文本 → HTTP 请求多个题库 → 各题库返回答案 → 相似度匹配 → 执行
 *   现在: 题目文本 + 选项 → 直接调用 LLM API → LLM 推理并返回答案 → 执行
 *
 * 核心变化：
 *   1. 不再需要维护题库配置文件（AnswererWrapper[]）
 *   2. LLM 能理解语义，不需要 string-similarity 做模糊匹配
 *   3. 一个 LLM 替代了 N 个题库 + 匹配算法的组合
 * ═══════════════════════════════════════════════════════════
 */

/**
 * LLM API 的连接配置
 *
 * 兼容 OpenAI / Azure OpenAI / 本地模型（Ollama/vLLM 等）
 */
export interface LLMConfig {
	/**
	 * API 地址（OpenAI 兼容格式）
	 *
	 * @example
	 * "https://api.openai.com/v1/chat/completions"      // OpenAI 官方
	 * "https://xxx.openai.azure.com/openai/deployments/..."  // Azure
	 * "http://localhost:11434/v1/chat/completions"       // Ollama 本地模型
	 * "https://api.deepseek.com/v1/chat/completions"     // DeepSeek
	 */
	url: string;

	/** API Key */
	apiKey: string;

	/** 模型名称，如 "gpt-4o", "deepseek-chat", "llama3" */
	model: string;

	/**
	 * 系统提示词（System Prompt）
	 * 用于告诉 LLM 它的角色和输出格式要求
	 */
	systemPrompt?: string;

	/**
	 * 请求超时时间（秒），默认 60
	 */
	timeoutSeconds?: number;

	/**
	 * 自定义请求头
	 */
	headers?: Record<string, string>;
}

/**
 * LLM 单次调用的请求参数
 */
export interface LLMRequest {
	/** 题目文本 */
	question: string;
	/** 选项文本列表（已清洗） */
	options: string[];
	/** 题目类型提示（可选，如果能从页面判断出来） */
	typeHint?: 'single' | 'multiple' | 'judgement' | 'completion';
	/** 当前平台的名称（供 LLM 参考） */
	platform?: string;
}

/**
 * LLM 返回的解析结果
 */
export interface LLMResponse {
	/** 答案文本 */
	answers: string[];
	/** LLM 判断的题目类型 */
	type: 'single' | 'multiple' | 'judgement' | 'completion';
	/** 推理过程（可用于展示/调试） */
	reasoning?: string;
}
