import {assert, test} from 'vitest';

import compileFileFilter from './file-filter.js';

test('compileFileFilter matches file names in any directory', () => {
	const matches = compileFileFilter('*.test.*');
	assert.isTrue(matches('foo.test.ts'));
	assert.isTrue(matches('source/helpers/foo.test.tsx'));
	assert.isTrue(matches('apps/api/src/__snapshots__/server.test.ts.snap'));
	assert.isFalse(matches('source/helpers/foo.ts'));
	assert.isFalse(matches('source/helpers/testing.ts'));
	assert.isFalse(matches('source/test.helpers/foo.ts'));
});

test('compileFileFilter reads one glob per line and skips blanks and comments', () => {
	const matches = compileFileFilter('  *.test.*  \n\n# Snapshots\n*.snap\n');
	assert.isTrue(matches('foo.test.ts'));
	assert.isTrue(matches('__snapshots__/foo.snap'));
	assert.isFalse(matches('# Snapshots'));
	assert.isFalse(matches('foo.ts'));
});

test('compileFileFilter anchors globs that contain a slash', () => {
	const matches = compileFileFilter('docs/*.md\n/build/**');
	assert.isTrue(matches('docs/readme.md'));
	assert.isFalse(matches('docs/guides/setup.md'));
	assert.isFalse(matches('packages/docs/readme.md'));
	assert.isTrue(matches('build/out.js'));
	assert.isTrue(matches('build/nested/out.js'));
	assert.isFalse(matches('source/build/out.js'));
});

test('compileFileFilter handles globstars and single characters', () => {
	const matches = compileFileFilter('packages/**/generated/**\nv?.json');
	assert.isTrue(matches('packages/generated/index.ts'));
	assert.isTrue(matches('packages/api-client/src/generated/@tanstack/react-query.gen.ts'));
	assert.isFalse(matches('apps/generated/index.ts'));
	assert.isTrue(matches('schemas/v1.json'));
	assert.isFalse(matches('schemas/v10.json'));
});

test('compileFileFilter escapes regex characters', () => {
	const matches = compileFileFilter('(legacy)+[v1].js');
	assert.isTrue(matches('lib/(legacy)+[v1].js'));
	assert.isFalse(matches('lib/legacyy1.js'));
});

test('compileFileFilter with an empty option matches nothing', () => {
	assert.isFalse(compileFileFilter('')('foo.test.ts'));
	assert.isFalse(compileFileFilter('\n# Nothing\n')('foo.test.ts'));
});
