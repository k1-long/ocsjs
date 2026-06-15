/**
 * ============================================================
 * 超星学习通 + LLM 大模型 集成示例
 *
 * 文件: packages/scripts/src/projects/cx-with-llm.example.ts
 *
 * 基于 cx.ts 原版改写的参考示例，展示 LLM 如何顶替传统题库。
 * ============================================================
 *
 * 【使用方式】
 * 在 cx.ts 的 work script 的 oncomplete 中，将原来的 OCSWorker 构造替换为以下代码。
 *
 * 【前置条件】
 * 1. 有一个 OpenAI 兼容的 API 端点（OpenAI / DeepSeek / Ollama / vLLM 等）
 * 2. 在脚本面板中配置 API Key（或硬编码，不推荐）
 */

import {
	OCSWorker,
	defaultAnswerWrapperHandler,
	$,
	StringUtils,
	request,
	createDefaultQuestionResolver,
	DefaultWork,
	splitAnswer,
	domSearch,
	domSearchAll,
	SearchInformation,
	// 👇 新增 LLM 模块导入
	createLLMAnswerer,
	callLLMSolve,
	LLMConfig
} from '@ocsjs/core';
import { $modal, h, $store, MessageElement, Project, Script, $el, $gm, $$el, $ui, cors, $message } from 'easy-us';
import { CommonProject } from './common';
import { workNotes, volume, playbackRate, dropdownStyle } from '../utils/configs';
import {
	answerWrapperEmptyWarning,
	commonWork,
	optimizationElementWithImage,
	removeRedundantWords,
	simplifyWorkResult
} from '../utils/work';

// ═══════════════════════════════════════════════════════
// 第一步：定义 LLM 配置
// ═══════════════════════════════════════════════════════

/**
 * 这里以 DeepSeek 为例（便宜、中文好、支持 OpenAI 格式）
 *
 * 其他可用选项：
 *   OpenAI:     url: 'https://api.openai.com/v1/chat/completions'
 *   Ollama本地:  url: 'http://localhost:11434/v1/chat/completions', model: 'llama3'
 *   DeepSeek:   url: 'https://api.deepseek.com/v1/chat/completions', model: 'deepseek-chat'
 *   Moonshot:   url: 'https://api.moonshot.cn/v1/chat/completions', model: 'moonshot-v1-8k'
 */
const llmConfig: LLMConfig = {
	url: 'https://api.deepseek.com/v1/chat/completions',
	apiKey: 'sk-your-api-key-here', // ⚠️ 生产环境应从 GM_getValue 读取
	model: 'deepseek-chat',
	timeoutSeconds: 30
};

// ═══════════════════════════════════════════════════════
// 第二步：创建 LLM 搜题器（替代原来的 answerer 函数）
// ═══════════════════════════════════════════════════════

const llmAnswerer = createLLMAnswerer(llmConfig, '超星学习通');

// ═══════════════════════════════════════════════════════
// 第三步：构造 OCSWorker —— 只改了 answerer 这一个参数！
// ═══════════════════════════════════════════════════════

export function createCXWorkerWithLLM() {
	return new OCSWorker({
		// ===== 以下参数完全不变 =====
		root: '.questionLi',
		elements: {
			title: '.mark_name',
			options: '.mark_letter',
			type: 'input[name="type"]',
			lineAnswerInput: '.textBox',
			lineSelectBox: '.selectBox',
			filling: '.filling',
			reading: '.reading',
		},

		// ===== 👇 原来这里调用 defaultAnswerWrapperHandler 👇 =====
		// answerer: (elements, ctx) => {
		//   const title = workOrExamQuestionTitleTransform(elements.title);
		//   const typeInput = elements.type[0] as HTMLInputElement;
		//   return defaultAnswerWrapperHandler(answererWrappers, {
		//     title,
		//     options: elements.options.map(o => o.innerText).join('\n'),
		//     type: typeInput?.value
		//   });
		// },
		//
		// ===== 👇 现在只改这一行！ LLM 替代多题库并发请求 👇 =====
		answerer: llmAnswerer,
		//    llmAnswerer 内部做的事：
		//    1. 从 elements.title 提取题目文本
		//    2. 从 elements.options 提取选项文本
		//    3. 拼成 prompt → 调 LLM API
		//    4. 解析 LLM 返回的 JSON → 包装成 SearchInformation[]
		//    5. 返回给下游的 resolver 和 handler

		// ===== 以下 handler 完全不变 =====
		work: {
			handler(type, answer, option, ctx) {
				const typeInput = ctx.elements.type[0] as HTMLInputElement;

				if (type === 'judgement' || type === 'single' || type === 'multiple') {
					if (!option.querySelector('input')?.checked) {
						option.click();
					}
				} else if (type === 'completion') {
					const textarea = option.querySelector('textarea');
					if (textarea) {
						textarea.value = answer;
						textarea.dispatchEvent(new Event('input', { bubbles: true }));
					}
				}
			}
		},

		thread: 1,
		answerMatchMode: 'similar',
	});
}

// ═══════════════════════════════════════════════════════
// 第四步（可选）：使用方式 B — LLM 完整求解
// ═══════════════════════════════════════════════════════

export async function solveWithLLMDirect(
	question: string,
	options: string[]
) {
	const result = await callLLMSolve(
		llmConfig,
		question,
		options,
		undefined,
		'超星学习通'
	);

	console.log('LLM 推理:', result.reasoning);
	console.log('答案:', result.answers);
	console.log('选项索引:', result.optionIndices);

	return result;
}

/*
 * ============================================================
 * 架构变化总结：
 *
 *   原来的数据流：
 *     title.innerText → defaultAnswerWrapperHandler()
 *       → 并发请求 题库A/题库B/题库C
 *       → 各题库返回 [question, answer]
 *       → SearchInformation[]
 *       → createDefaultQuestionResolver()
 *       → string-similarity 相似度匹配（Dice Coefficient）
 *       → 找到最佳选项
 *       → handler(type, answer, element)
 *       → element.click() / textarea.value = answer
 *
 *   LLM 方式 A 的数据流：
 *     title.innerText → createLLMAnswerer()
 *       → 单次 LLM API 调用
 *       → LLM 返回 JSON { type, answers, reasoning }
 *       → SearchInformation[]（兼容格式）
 *       → createDefaultQuestionResolver()（保持不变）
 *       → string-similarity 相似度匹配（保持不变）
 *       → handler(type, answer, element)
 *       → element.click() / textarea.value = answer
 *
 *   LLM 方式 B 的数据流：
 *     title.innerText + options[].innerText → callLLMSolve()
 *       → 单次 LLM API 调用（带着选项文本）
 *       → LLM 返回 JSON { type, answers, optionIndices }
 *       → 直接用 optionIndices 找到对应 options[index]
 *       → handler(type, answers[0], options[optionIndices[0]])
 *       → element.click() / textarea.value = answer
 *
 *   ╔═══════════════════════════════════════════════════════╗
 *   ║  LLM 顶替的核心组件：                                  ║
 *   ║                                                       ║
 *   ║  1. defaultAnswerWrapperHandler  → 不再需要           ║
 *   ║     原：管理 N 个题库配置、并发请求、占位符替换         ║
 *   ║     新：LLM 单次 API 调用，语义理解替代多题库聚合       ║
 *   ║                                                       ║
 *   ║  2. AnswererWrapper[] 题库配置  → 不再需要             ║
 *   ║     原：用户配置 JSON（url/method/data/handler）        ║
 *   ║     新：LLM 自带"知识库"，无需外部题库                  ║
 *   ║                                                       ║
 *   ║  3. AnswerWrapperParser    → 不再需要                  ║
 *   ║     原：解析 JSON/URL/base64 题库配置                  ║
 *   ║     新：无题库配置，无需解析                            ║
 *   ║                                                       ║
 *   ║  4. (方式B) createDefaultQuestionResolver → 不再需要   ║
 *   ║     原：string-similarity 相似度匹配 + 投票机制         ║
 *   ║     新：LLM 直接返回 optionIndices                     ║
 *   ║                                                       ║
 *   ║  以下组件保留不变：                                     ║
 *   ║  ✅ domSearchAll      — 仍然需要从 DOM 提取题目元素     ║
 *   ║  ✅ OCSWorker.doWork  — 多线程调度引擎仍然使用          ║
 *   ║  ✅ work.handler      — 点击/填写操作仍然由平台定义      ║
 *   ║  ✅ waitForMedia      — 视频播放逻辑不变                ║
 *   ╚═══════════════════════════════════════════════════════╝
 */
