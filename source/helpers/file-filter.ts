function globToRegexSource(glob: string): string {
	let source = '';
	for (let index = 0; index < glob.length; index++) {
		const character = glob[index];
		if (character === '*' && glob[index + 1] === '*') {
			index++;
			if (glob[index + 1] === '/') {
				// `**/` matches zero or more whole directories
				index++;
				source += '(?:.*/)?';
			} else {
				source += '.*';
			}
		} else if (character === '*') {
			source += '[^/]*';
		} else if (character === '?') {
			source += '[^/]';
		} else {
			source += character.replaceAll(/[$()+.[\\\]^{|}]/g, String.raw`\$&`);
		}
	}

	return source;
}

/**
Compiles the `fileFilter` option into a matcher for repository-relative file paths.

The option holds one glob per line; blank lines and lines starting with `#` are ignored. Globs follow `.gitignore` conventions: a glob without `/` matches the file name in any directory, a glob with `/` matches the whole path from the repository root, `*` and `?` stay within one path segment, and `**` spans directories. An empty option matches nothing.
*/
export default function compileFileFilter(option: string): (path: string) => boolean {
	const regexes = option
		.split('\n')
		.map(line => line.trim())
		.filter(line => line && !line.startsWith('#'))
		.map(glob => {
			const source = globToRegexSource(glob.replace(/^\//, ''));
			return new RegExp(glob.includes('/') ? `^${source}$` : `(?:^|/)${source}$`);
		});

	return path => regexes.some(regex => regex.test(path));
}
