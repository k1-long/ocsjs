/**
 * LLM 大模型答题器 — 核心实现
 *
 * ═══════════════════════════════════════════════════════════════
 * 这个文件提供了两种使用方式：
 *
 * 【方式 A】createLLMAnswerer — 作为「搜题器」的替代品
 *   顶替位置：OCSWorker 的 answerer 参数
 *   原位置：defaultAnswerWrapperHandler(answererWrappers, env)
 *   工作流：题目文本 → LLM API → 解析出答案字符串 → 交给原有的 QuestionResolver 做选项匹配
 *
 * 【方式 B】createLLMFullSolver — 作为「搜题+解题」的完整替代品
 *   顶替位置：同时替代 OCSWorker 的 answerer + work.handler
 *   工作流：题目文本+选项列表 → LLM API → LLM 直接指定"第几个选项" → 直接点击/填写
 *   这种方式跳过了 createDefaultQuestionResolver 的相似度匹配步骤
 *
 * 架构对比：
 *
 *   ┌─ 原架构 ────────────────────────────────────────┐
 *   │                                                  │
 *   │  answerer(题目) ──→ 题库A/B/C ──→ 答案列表       │
 *   │       ↓                                          │
 *   │  resolver(答案, 选项) ──→ string-similarity 匹配  │
 *   │       ↓                                          │
 *   │  handler(type, answer, element) ──→ click/fill   │
 *   │                                                  │
 *   └──────────────────────────────────────────────────┘
 *
 *   ┌─ 方式 A：LLM 只替代搜题层 ───────────────────────┐
 *   │                                                  │
 *   │  LLMAnswerer(题目) ──→ LLM API ──→ 答案文本      │
 *   │       ↓                                          │
 *   │  resolver(答案, 选项) ──→ string-similarity 匹配  │
 *   │       ↓                                          │
 *   │  handler(type, answer, element) ──→ click/fill   │
 *   │                                                  │
 *   └──────────────────────────────────────────────────┘
 *
 *   ┌─ 方式 B：LLM 替代搜题+匹配 ──────────────────────┐
 *   │                                                  │
 *   │  LLMFullSolver(题目+选项) ──→ LLM API             │
 *   │       ↓                                          │
 *   │  直接返回: { type, answers, optionIndex }         │
 *   │       ↓                                          │
 *   │  handler(type, answer, element) ──→ click/fill   │
 *   │                                                  │
 *   └──────────────────────────────────────────────────┘
 * ═══════════════════════════════════════════════════════════
 */

import type { AnswererType, QuestionTypes, SearchInformation } from '../worker/interface';
import type { LLMConfig, LLMRequest, LLMResponse } from './types';
import { request } from '../utils/request';
import { $ } from '../../utils';
import { removeRedundant } from '../utils/string';

// ═══════════════════════════════════════════════════════
// 默认系统提示词
// ═══════════════════════════════════════════════════════

const DEFAULT_SYSTEM_PROMPT = '你是一个专业的网课答题助手。你的任务是：\n1. 仔细阅读题目\n2. 分析所有选项\n3. 选出最正确的答案\n\n请严格按照以下 JSON 格式回复（不要包含其他文字）：\n\n{\n  "type": "题目类型",\n  "answers": ["答案1"],\n  "reasoning": "简要推理过程"\n}\n\n规则：\n- type 只能是: "single"(单选), "multiple"(多选), "judgement"(判断), "completion"(填空)\n- 单选题和多选题：answers 数组里放正确选项的完整文本，不要只写ABCD\n- 判断题：answers 数组里放"正确"或"错误"\n- 填空题：answers 数组里放填空答案，多个空用数组的多个元素表示\n- 如果不知道答案，answers 放空数组 []';

// ═══════════════════════════════════════════════════════
// 构建发送给 LLM 的 user prompt
// ═══════════════════════════════════════════════════════

function buildUserPrompt(req: LLMRequest): string {
	let prompt = `【题目】${req.question}`;

	if (req.options.length > 0) {
		const labels = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
		prompt += '\n\n【选项】';
		req.options.forEach((opt, i) => {
			prompt += `\n${labels[i] || i}. ${opt}`;
		});
	}

	if (req.typeHint) {
		const typeNames: Record<string, string> = {
			single: '单选题（只有一个正确答案）',
			multiple: '多选题（可能有多个正确答案）',
			judgement: '判断题（正确或错误）',
			completion: '填空题（需要填入文字）'
		};
		prompt += `\n\n【题目类型提示】${typeNames[req.typeHint] || req.typeHint}`;
	}

	if (req.platform) {
		prompt += `\n\n【平台】${req.platform}`;
	}

	return prompt;
}

// ═══════════════════════════════════════════════════════
// 调用 LLM API（OpenAI 兼容格式）
// ═══════════════════════════════════════════════════════

async function callLLM(config: LLMConfig, userPrompt: string): Promise<LLMResponse> {
	const messages = [
		{ role: 'system', content: config.systemPrompt || DEFAULT_SYSTEM_PROMPT },
		{ role: 'user', content: userPrompt }
	];

	const body = JSON.stringify({
		model: config.model,
		messages,
		temperature: 0.1,
		max_tokens: 2000
	});

	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		Authorization: `Bearer ${config.apiKey}`,
		...config.headers
	};

	try {
		// 先尝试 GM_xmlhttpRequest（油猴环境跨域），失败回退到 fetch
		let response: any;
		try {
			response = await request(config.url, {
				method: 'post',
				type: 'GM_xmlhttpRequest',
				responseType: 'json',
				headers,
				data: JSON.parse(body)
			});
		} catch {
			response = await request(config.url, {
				method: 'post',
				type: 'fetch',
				responseType: 'json',
				headers,
				data: JSON.parse(body)
			});
		}

		// 超时处理
		const result = await Promise.race([
			Promise.resolve(response),
			$.sleep((config.timeoutSeconds || 60) * 1000).then(() => undefined)
		]);

		if (!result) {
			throw new Error('LLM 请求超时');
		}

		const content: string =
			result?.choices?.[0]?.message?.content || result?.data?.content || '';

		if (!content) {
			throw new Error('LLM 返回内容为空');
		}

		// 从响应中提取 JSON（LLM 可能会在 JSON 外包裹 markdown 代码块）
		const jsonMatch = content.match(/\{[\s\S]*\}/);
		if (!jsonMatch) {
			throw new Error(`无法从 LLM 响应中解析 JSON: ${content.slice(0, 200)}`);
		}

		const parsed = JSON.parse(jsonMatch[0]) as LLMResponse;

		if (!parsed.answers || !Array.isArray(parsed.answers)) {
			throw new Error('LLM 返回的 JSON 缺少 answers 字段');
		}

		return parsed;
	} catch (err) {
		if (err instanceof Error) {
			throw err;
		}
		throw new Error(`LLM 调用失败: ${String(err)}`);
	}
}

// ═══════════════════════════════════════════════════════
// 方式 A：LLM 作为「搜题器」（替代 defaultAnswerWrapperHandler）
// ═══════════════════════════════════════════════════════

/**
 * 创建一个 LLM 驱动的搜题器函数
 *
 * ========================================
 * 顶替位置：OCSWorker 构造参数中的 answerer
 *
 * 原来：
 *   answerer: (elements, ctx) => defaultAnswerWrapperHandler(answererWrappers, { title, options, type })
 *
 * 现在：
 *   answerer: createLLMAnswerer(llmConfig, platformName)
 * ========================================
 *
 * @param config  - LLM 连接配置（API 地址、密钥、模型）
 * @param platformName - 平台名称（会放进 prompt 帮助 LLM 理解上下文）
 * @returns 一个符合 AnswererType 签名的函数
 *
 * @example
 * ```ts
 * const worker = new OCSWorker({
 *   root: '.questionLi',
 *   elements: { title: '.title', options: '.option', type: 'input[name="type"]' },
 *   answerer: createLLMAnswerer({
 *     url: 'https://api.deepseek.com/v1/chat/completions',
 *     apiKey: 'sk-xxx',
 *     model: 'deepseek-chat',
 *   }, '超星学习通'),
 *   work: { handler(type, answer, el) { ... } }
 * });
 * await worker.doWork();
 * ```
 */
export function createLLMAnswerer(
	config: LLMConfig,
	platformName?: string
): AnswererType<any> {
	return async (elements, ctx) => {
		// 1. 从页面元素提取题目和选项文本
		const question = (elements.title || [])
			.map((el: HTMLElement) => el?.innerText?.trim() || '')
			.filter(Boolean)
			.join(' ');

		const options = (elements.options || [])
			.map((el: HTMLElement) => removeRedundant(el?.innerText || ''))
			.filter(Boolean);

		if (!question) {
			return [];
		}

		// 2. 获取题目类型
		const typeHint = ctx.type;

		// 3. 构建请求、调用 LLM
		const llmReq: LLMRequest = {
			question,
			options,
			typeHint: typeHint as LLMRequest['typeHint'],
			platform: platformName
		};

		try {
			const llmResult = await callLLM(config, buildUserPrompt(llmReq));

			// 4. 将 LLM 返回的答案包装成 SearchInformation[] 格式
			//    这样就能无缝接入现有的 resolver 流程
			const searchInfos: SearchInformation[] = [
				{
					name: `LLM (${config.model})`,
					homepage: 'https://api.openai.com',
					url: config.url,
					results: llmResult.answers.map((ans) => ({
						question: question,
						answer: ans,
						extra_data: { reasoning: llmResult.reasoning, type: llmResult.type }
					})),
					response: llmResult
				}
			];

			return searchInfos;
		} catch (err) {
			console.error('[LLM Answerer] 调用失败:', err);
			return [
				{
					name: `LLM (${config.model})`,
					url: config.url,
	
