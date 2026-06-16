import type { AnswererType, QuestionTypes, SearchedElements, WorkContext } from '../worker/interface';
import type { SearchInformation } from '../answer-wrapper/interface';
import type { LLMConfig, LLMRequest, LLMResponse } from './types';
import { request } from '../utils/request';
import { $ } from '../../utils';
import { removeRedundant } from '../utils/string';

const DEFAULT_SYSTEM_PROMPT = [
	'你是一个专业的网课答题助手。',
	'请严格按照以下 JSON 格式回复（不要包含其他文字）：',
	'{ "type": "题目类型", "answers": ["答案"], "reasoning": "推理过程" }',
	'规则：type 只能是 single/multiple/judgement/completion',
	'选择题 answers 放正确选项的完整文本，判断题放"正确"或"错误"',
	'填空题 answers 放答案文本，不知道答案时 answers 放空数组 []'
].join('\n');

function buildUserPrompt(req: LLMRequest): string {
	let prompt = `【题目】${req.question}`;
	if (req.options.length > 0) {
		prompt += '\n\n【选项】';
		req.options.forEach((opt, i) => { prompt += `\n${String.fromCharCode(65 + i)}. ${opt}`; });
	}
	if (req.typeHint) {
		const typeNames: Record<string, string> = {
			single: '单选题', multiple: '多选题', judgement: '判断题', completion: '填空题'
		};
		prompt += `\n\n【题目类型】${typeNames[req.typeHint] || req.typeHint}`;
	}
	if (req.platform) prompt += `\n\n【平台】${req.platform}`;
	return prompt;
}

async function callLLM(config: LLMConfig, userPrompt: string): Promise<LLMResponse> {
	const messages = [
		{ role: 'system', content: config.systemPrompt || DEFAULT_SYSTEM_PROMPT },
		{ role: 'user', content: userPrompt }
	];
	const body = JSON.stringify({ model: config.model, messages, temperature: 0.1, max_tokens: 2000 });
	const headers: Record<string, string> = { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}`, ...config.headers };
	try {
		let response: any;
		try { response = await request(config.url, { method: 'post', type: 'GM_xmlhttpRequest', responseType: 'json', headers, data: JSON.parse(body) }); }
		catch { response = await request(config.url, { method: 'post', type: 'fetch', responseType: 'json', headers, data: JSON.parse(body) }); }
		const result = await Promise.race([Promise.resolve(response), $.sleep((config.timeoutSeconds || 60) * 1000).then(() => undefined)]);
		if (!result) throw new Error('LLM 请求超时');
		const content: string = result?.choices?.[0]?.message?.content || result?.data?.content || '';
		if (!content) throw new Error('LLM 返回内容为空');
		const jsonMatch = content.match(/\{[\s\S]*\}/);
		if (!jsonMatch) throw new Error('无法解析 LLM 响应');
		const parsed = JSON.parse(jsonMatch[0]) as LLMResponse;
		if (!parsed.answers || !Array.isArray(parsed.answers)) throw new Error('LLM 响应缺少 answers 字段');
		return parsed;
	} catch (err) { if (err instanceof Error) throw err; throw new Error(`LLM 调用失败: ${String(err)}`); }
}

export function createLLMAnswerer(config: LLMConfig, platformName?: string): AnswererType<any> {
	return async (elements: SearchedElements<any, HTMLElement[]>, ctx: WorkContext<SearchedElements<any, HTMLElement[]>>) => {
		const question = (elements.title || []).map((el) => el?.innerText?.trim() || '').filter(Boolean).join(' ');
		const options = (elements.options || []).map((el) => removeRedundant(el?.innerText || '')).filter(Boolean);
		if (!question) return [];
		const llmReq: LLMRequest = { question, options, typeHint: ctx.type as LLMRequest['typeHint'], platform: platformName };
		try {
			const r = await callLLM(config, buildUserPrompt(llmReq));
			return [{ name: `LLM (${config.model})`, homepage: '#', url: config.url, results: r.answers.map((a) => ({ question, answer: a, extra_data: { reasoning: r.reasoning, type: r.type } })), response: r }] as SearchInformation[];
		} catch (err) {
			console.error('[LLM Answerer]', err);
			return [{ name: `LLM (${config.model})`, url: config.url, homepage: '#', results: [], error: err instanceof Error ? err.message : String(err) }] as SearchInformation[];
		}
	};
}

export interface LLMSolveResult { type: QuestionTypes; answers: string[]; optionIndices?: number[]; reasoning?: string; }

export async function callLLMSolve(config: LLMConfig, question: string, options: string[], typeHint?: QuestionTypes, platformName?: string): Promise<LLMSolveResult> {
	const llmReq: LLMRequest = { question, options, typeHint: typeHint as LLMRequest['typeHint'], platform: platformName };
	const enhancedPrompt = buildUserPrompt(llmReq) + '\n\n返回 optionIndices 字段（数字数组，A=0...）。判断:0=正确 1=错误。';
	const r = await callLLM(config, enhancedPrompt);
	return { type: r.type as QuestionTypes, answers: r.answers, optionIndices: (r as any).optionIndices, reasoning: r.reasoning };
}

export function createLLMBoundSolver(config: LLMConfig, platformName?: string) {
	return async (question: string, options: string[], typeHint?: QuestionTypes) => callLLMSolve(config, question, options, typeHint, platformName);
}
