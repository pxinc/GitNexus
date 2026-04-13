#include <tree_sitter/parser.h>
#include <stdio.h>
#include <string.h>
#include <wctype.h>

// External scanner for ArkTS template literals
// Handles nested ${...} inside template strings to avoid ambiguity with block_statement closing braces

enum TokenType {
  TEMPLATE_CHARS_TOKEN,
};

void *tree_sitter_arkts_external_scanner_create(void) { return NULL; }
void tree_sitter_arkts_external_scanner_destroy(void *p) {}
unsigned tree_sitter_arkts_external_scanner_serialize(void *p, char *buffer) { return 0; }
void tree_sitter_arkts_external_scanner_deserialize(void *p, const char *b, unsigned n) {}

static void advance(TSLexer *lexer) { lexer->advance(lexer, false); }
static void skip(TSLexer *lexer) { lexer->advance(lexer, true); }

bool tree_sitter_arkts_external_scanner_scan(void *payload, TSLexer *lexer, const bool *valid_symbols) {
  if (!valid_symbols[TEMPLATE_CHARS_TOKEN]) return false;
  
  // Debug: write to stderr
  fprintf(stderr, "SCANNER CALLED\n");

  // Only match template_chars when we're inside a template literal
  // (i.e., the previous token was either a backtick or a template_substitution closing brace)
  
  // Template chars: everything up to a backtick, dollar sign, or backslash
  // Also matches '}' characters which would otherwise be ambiguous with block_statement
  
  bool has_content = false;
  while (true) {
    if (lexer->lookahead == '`') {
      // End of template literal - don't consume
      break;
    }
    if (lexer->lookahead == '$') {
      // Possible template substitution start
      lexer->mark_end(lexer);
      advance(lexer);
      if (lexer->lookahead == '{') {
        // Template substitution - don't consume ${ 
        break;
      }
      // Not a substitution, continue
      has_content = true;
      continue;
    }
    if (lexer->lookahead == '\\') {
      // Escape sequence
      advance(lexer);
      if (lexer->lookahead != 0) advance(lexer);
      has_content = true;
      continue;
    }
    if (lexer->lookahead == 0) break;
    
    // Regular character including '}' - consume it
    advance(lexer);
    has_content = true;
  }
  
  if (has_content) {
    lexer->result_symbol = TEMPLATE_CHARS_TOKEN;
    return true;
  }
  return false;
}
