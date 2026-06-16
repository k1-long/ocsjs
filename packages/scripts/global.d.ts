import * as Core from './src/index';

declare global {
	export declare const OCS: typeof Core;
	export declare const STYLE: string;
}

declare module 'dom-to-image-more' {
	import domToImage = require('dom-to-image');
	export = domToImage;
}

declare module 'lodash/debounce' {
	import { DebouncedFunc } from 'lodash';
	const debounce: <T extends (...args: any) => any>(func: T, wait?: number, options?: { leading?: boolean; trailing?: boolean; maxWait?: number }) => T & DebouncedFunc<T>;
	export default debounce;
}
