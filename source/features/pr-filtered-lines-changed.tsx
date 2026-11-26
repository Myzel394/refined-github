import React from 'dom-chef';
import * as pageDetect from 'github-url-detection';
import CpuIcon from 'octicons-plain-react/Cpu';
import FilterIcon from 'octicons-plain-react/Filter';
import {CachedFunction} from 'webext-storage-cache';

import {withTooltipRef} from '../components/tooltip.js';
import features from '../feature-manager.js';
import api from '../github-helpers/api.js';
import {getConversationNumber, getRepo} from '../github-helpers/index.js';
import {has} from '../helpers/css-selectors.js';
import compileFileFilter from '../helpers/file-filter.js';
import onetime from '../helpers/onetime.js';
import pluralize from '../helpers/pluralize.js';
import observe from '../helpers/selector-observer.js';
import optionsStorage from '../options-storage.js';
import GetPullRequestFiles from './pr-filtered-lines-changed.gql';

type ChangedFile = {
	path: string;
	additions: number;
	deletions: number;
	isGenerated: boolean;
};

// Larger queries time out (HTTP 502) on big monorepos
const directoriesPerQuery = 6;

function getDirectory(path: string): string {
	return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
}

// Only `TreeEntry` exposes GitHub's (Linguist's) generated flag, so list the trees containing the changed files
async function getGeneratedPaths(expressions: string[]): Promise<Set<string>> {
	const generated = new Set<string>();
	for (let index = 0; index < expressions.length; index += directoriesPerQuery) {
		const aliases = expressions
			.slice(index, index + directoriesPerQuery)
			.map((expression, alias) => `d${alias}: object(expression: ${JSON.stringify(expression)}) {
				... on Tree { entries { path isGenerated } }
			}`);

		// eslint-disable-next-line no-await-in-loop -- Sequential to avoid timeouts
		const {repository} = await api.v4(`repository() {${aliases.join('\n')}}`);
		for (const tree of Object.values<{entries: Array<{path: string; isGenerated: boolean}>}>(repository)) {
			for (const entry of tree.entries) {
				if (entry.isGenerated) {
					generated.add(entry.path);
				}
			}
		}
	}

	return generated;
}

const changedFiles = new CachedFunction('pr-filtered-lines-changed', {
	async updater(number: number, _headOid: string): Promise<ChangedFile[] | false> {
		type PullRequestFiles = {
			changedFiles: number;
			headRefOid: string;
			baseRefOid: string;
			files: {
				nodes: Array<{path: string; additions: number; deletions: number; changeType: string}>;
				pageInfo: {hasNextPage: boolean; endCursor: string};
			};
		};

		let pullRequest: PullRequestFiles;
		let cursor: string | undefined;
		const files: PullRequestFiles['files']['nodes'] = [];
		do {
			// eslint-disable-next-line no-await-in-loop -- Pagination
			({repository: {pullRequest}} = await api.v4(GetPullRequestFiles, {
				variables: {number, ...cursor && {cursor}},
			}));
			files.push(...pullRequest.files.nodes);
			cursor = pullRequest.files.pageInfo.endCursor;
		} while (pullRequest.files.pageInfo.hasNextPage);

		// GitHub caps the file list; partial numbers would be misleading
		if (files.length !== pullRequest.changedFiles) {
			return false;
		}

		// Deleted files only exist in the base tree; renamed files are listed by their new path
		const expressions = new Set(
			files.map(file =>
				`${file.changeType === 'DELETED' ? pullRequest.baseRefOid : pullRequest.headRefOid}:${getDirectory(file.path)}`
			),
		);
		const generated = await getGeneratedPaths([...expressions]);
		return files.map(({path, additions, deletions}) => ({path, additions, deletions, isGenerated: generated.has(path)}));
	},
	maxAge: {days: 7},
	staleWhileRevalidate: {days: 30},
	// The head SHA changes on every push, so a new push invalidates the cache
	cacheKey: ([number, headOid]) => `${getRepo()!.nameWithOwner}#${number}@${headOid}`,
});

async function getChangedFiles(): Promise<ChangedFile[] | false> {
	const number = getConversationNumber()!;
	const {repository} = await api.v4(`repository() {
		pullRequest(number: ${number}) { headRefOid }
	}`);
	return changedFiles.get(number, repository.pullRequest.headRefOid);
}

type Variant = {
	files: ChangedFile[];
	tooltip: string;
	Icon: typeof FilterIcon;
};

function getVariants(files: ChangedFile[], fileFilter: string): Variant[] {
	const variants: Variant[] = [];
	const total = files.length;
	const describe = (count: number): string =>
		`${count.toLocaleString('en-US')} of ${pluralize(total, '1 file', '$$ files')}`;

	const isFiltered = compileFileFilter(fileFilter);
	const unfiltered = files.filter(file => !isFiltered(file.path));
	const hasFilteredFiles = unfiltered.length < total;
	if (hasFilteredFiles) {
		const globs = fileFilter.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'));
		variants.push({
			files: unfiltered,
			tooltip: `${describe(unfiltered.length)}, excluding ${globs.join(', ')}`,
			Icon: FilterIcon,
		});
	}

	const handwritten = unfiltered.filter(file => !file.isGenerated);
	const generatedCount = unfiltered.length - handwritten.length;
	if (generatedCount > 0) {
		const generated = pluralize(generatedCount, '1 generated file', '$$ generated files');
		variants.push({
			files: handwritten,
			tooltip: `${describe(handwritten.length)}, ${hasFilteredFiles ? 'also ' : ''}excluding ${generated}`,
			Icon: CpuIcon,
		});
	}

	return variants;
}

function sum(files: ChangedFile[], key: 'additions' | 'deletions'): string {
	return files.reduce((total, file) => total + file[key], 0).toLocaleString('en-US');
}

async function add(diffstat: HTMLElement, getFiles: () => Promise<ChangedFile[] | false>): Promise<void> {
	const [files, {fileFilter}] = await Promise.all([getFiles(), optionsStorage.getAll()]);
	if (!files) {
		return;
	}

	const variants = getVariants(files, fileFilter);
	if (variants.length === 0) {
		return;
	}

	diffstat.append(
		<span className="rgh-pr-filtered-lines-changed d-none d-lg-flex flex-items-center gap-2 ml-2">
			{variants.map(variant => (
				<span ref={withTooltipRef(variant.tooltip)} tabIndex={0} className="d-flex flex-items-center gap-1 color-fg-muted">
					<variant.Icon />
					<span className="f6 color-fg-success text-bold">+{sum(variant.files, 'additions')}</span>
					<span className="f6 color-fg-danger text-bold">-{sum(variant.files, 'deletions')}</span>
				</span>
			))}
		</span>,
	);
}

async function init(signal: AbortSignal): Promise<void> {
	const getFiles = onetime(getChangedFiles);
	// The native "+A -D" diffstat in the PR header
	observe(
		`div[class^="rightContentWrapper"] > div.d-flex${has('> .fgColor-success + .fgColor-danger')}`,
		async diffstat => add(diffstat, getFiles),
		{signal},
	);
}

void features.add(import.meta.url, {
	include: [
		pageDetect.isPR,
	],
	requiresToken: true,
	init,
});
