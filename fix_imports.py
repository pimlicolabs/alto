#!/usr/bin/env python3
import os
import re
from collections import defaultdict

def parse_imports(content):
    """Parse imports from a file and group by module path."""
    lines = content.split('\n')
    imports = []

    i = 0
    while i < len(lines):
        line = lines[i].strip()

        # Match type import
        type_match = re.match(r'^import type \{([^}]+)\} from ["\']([^"\']+)["\']', line)
        if type_match:
            imports.append({
                'line_num': i,
                'type': 'type',
                'items': [item.strip() for item in type_match.group(1).split(',')],
                'module': type_match.group(2),
                'original': lines[i]
            })
            i += 1
            continue

        # Match regular import
        value_match = re.match(r'^import \{([^}]+)\} from ["\']([^"\']+)["\']', line)
        if value_match:
            imports.append({
                'line_num': i,
                'type': 'value',
                'items': [item.strip() for item in value_match.group(1).split(',')],
                'module': value_match.group(2),
                'original': lines[i]
            })
            i += 1
            continue

        i += 1

    return imports, lines

def find_duplicate_imports(imports):
    """Find imports from the same module."""
    module_imports = defaultdict(list)

    for imp in imports:
        module_imports[imp['module']].append(imp)

    duplicates = {}
    for module, imps in module_imports.items():
        if len(imps) > 1:
            # Check if there's a type and value import
            has_type = any(i['type'] == 'type' for i in imps)
            has_value = any(i['type'] == 'value' for i in imps)

            if has_type and has_value:
                duplicates[module] = imps

    return duplicates

def consolidate_imports(imports, lines):
    """Consolidate duplicate imports into single statements."""
    duplicates = find_duplicate_imports(imports)

    if not duplicates:
        return None

    # Process each set of duplicates
    lines_to_remove = set()
    lines_to_add = {}

    for module, imps in duplicates.items():
        # Sort by line number
        imps.sort(key=lambda x: x['line_num'])

        # Separate type and value imports
        type_imports = []
        value_imports = []

        for imp in imps:
            if imp['type'] == 'type':
                type_imports.extend(imp['items'])
            else:
                value_imports.extend(imp['items'])

        # Create consolidated import
        all_imports = []
        if value_imports:
            all_imports.extend(value_imports)
        if type_imports:
            all_imports.extend([f"type {item}" for item in type_imports])

        consolidated = f"import {{ {', '.join(all_imports)} }} from \"{module}\""

        # Mark all lines for removal except the first
        first_line = imps[0]['line_num']
        for imp in imps:
            lines_to_remove.add(imp['line_num'])

        # Add consolidated import at the first line
        lines_to_add[first_line] = consolidated

    # Build new content
    new_lines = []
    for i, line in enumerate(lines):
        if i in lines_to_remove:
            if i in lines_to_add:
                new_lines.append(lines_to_add[i])
        else:
            new_lines.append(line)

    return '\n'.join(new_lines)

def process_file(filepath):
    """Process a single TypeScript file."""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()

        imports, lines = parse_imports(content)
        duplicates = find_duplicate_imports(imports)

        if not duplicates:
            return False

        new_content = consolidate_imports(imports, lines)

        if new_content:
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(new_content)
            return True

    except Exception as e:
        print(f"Error processing {filepath}: {e}")

    return False

def main():
    """Main function to process all TypeScript files."""
    base_dir = '/Users/mous/Work/pimlico/alto'
    directories = [
        os.path.join(base_dir, 'src'),
        os.path.join(base_dir, 'test')
    ]
    modified_files = []

    for src_dir in directories:
        if not os.path.exists(src_dir):
            continue

        for root, dirs, files in os.walk(src_dir):
            # Skip esm directory (generated files)
            if 'esm' in dirs:
                dirs.remove('esm')

            for file in files:
                if file.endswith('.ts') and not file.endswith('.d.ts'):
                    filepath = os.path.join(root, file)
                    if process_file(filepath):
                        modified_files.append(filepath)

    print(f"Modified {len(modified_files)} files:")
    for file in modified_files:
        print(file)

if __name__ == '__main__':
    main()
