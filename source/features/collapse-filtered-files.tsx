import {onAbort} from 'abort-utils';
import * as pageDetect from 'github-url-detection';
import {closestElement, elementExists} from 'select-dom';

import features from '../feature-manager.js';
import {has} from '../helpers/css-selectors.js';
import compileFileFilter from '../helpers/file-filter.js';
import observe from '../helpers/selector-observer.js';
import optionsStorage from '../options-storage.js';
import {getFilePath} from './actionable-pr-view-file.js';

const toggleSelector = [
	'[class*="diffHeaderWrapper"] button' + has('> .octicon-chevron-down', '> .octicon-chevron-right'),
	// TODO [2027-01-01]: Old PR Files view, drop
	'.file-header button.js-details-target[aria-expanded]',
] as const;

const fileSelector = [
	'[class*="diffTargetable"]',
	// TODO [2027-01-01]: Old PR Files view, drop
	'.js-file',
] as const;

function isExpanded(toggle: Element): boolean {
	return toggle.ariaExpanded
		? toggle.ariaExpanded === 'true'
		: elementExists(':scope > .octicon-chevron-down', toggle);
}

function getPath(file: HTMLElement): string {
	// TODO [2027-01-01]: Old PR Files view, drop
	if (file.dataset.tagsearchPath) {
		return file.dataset.tagsearchPath;
	}

	return getFilePath(file);
}

// The user navigated to this file on purpose, e.g. via a `#diff-…` link or a link to a review comment
function isLinked(file: HTMLElement, linkedId: string): boolean {
	return linkedId !== ''
		&& ((file.id !== '' && linkedId.startsWith(file.id)) || file.contains(document.getElementById(linkedId)));
}

async function init(signal: AbortSignal): Promise<void | false> {
	// Read it before GitHub drops it from the URL while the diff loads
	const linkedId = decodeURIComponent(location.hash.slice(1));
	const {fileFilter} = await optionsStorage.getAll();
	// Same line rules as `compileFileFilter`: blank lines and `#` comments are not patterns
	const hasPatterns = fileFilter.split('\n').map(line => line.trim()).some(line => line && !line.startsWith('#'));
	if (!hasPatterns) {
		return false;
	}

	const matches = compileFileFilter(fileFilter);

	// Each file is only collapsed the first time it appears, so files the user expands again stay expanded, even if GitHub re-renders them
	const seen = new Set<string>();
	onAbort(signal, () => {
		seen.clear();
	});

	observe(toggleSelector, toggle => {
		const file = closestElement(fileSelector, toggle);
		const path = getPath(file);
		if (seen.has(path)) {
			return;
		}

		seen.add(path);
		if (matches(path) && isExpanded(toggle) && !isLinked(file, linkedId)) {
			// No `altKey`: That would toggle every file
			(toggle as HTMLButtonElement).click();
		}
	}, {signal});
}

void features.add(import.meta.url, {
	include: [
		pageDetect.isPRFiles,
	],
	exclude: [
		pageDetect.isPRFile404,
		pageDetect.isPRCommit,
	],
	init,
});
