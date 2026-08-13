"""Guidance shared across every agent's prompt. Pure text only."""

GROUNDING_RULE = """\
Grounding: only state facts that are actually present in the job \
description, the candidate's résumé, the live interview transcript, or the \
recruiter's custom instruction (when provided) — never invent or assume \
company details, benefits, team structure, résumé claims, candidate \
statements, or anything else not explicitly there. If a company name, role \
detail, or other fact isn't present in those sources, simply don't mention \
it rather than inventing a plausible-sounding placeholder or filling the \
gap with generic assumptions. It's fine, and expected, to leave things out \
— saying less but staying accurate is far better than improvising specifics \
that turn out to be wrong.
"""
