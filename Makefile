# Ingest and build. See Docs/HANDOFF.md for where this is up to.
#
# Everything comes from nflverse, which publishes as GitHub release assets and
# refreshes nightly during the season. No key, no rate limit, no residential-IP
# problem — unlike the F1 project this was modelled on.

CACHE ?= .cache/nflverse
SITE  := site

.PHONY: help fetch emit data build preview check clean

help:
	@grep -E '^[a-z-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "};{printf "  %-10s %s\n", $$1, $$2}'

fetch: ## Download the schedule and this season's play-by-play from nflverse
	python3 pipeline/fetch.py

emit: ## nflverse CSV -> canonical JSON in site/data/
	python3 pipeline/emit.py

data: fetch emit ## Full data refresh

build: ## Build the site and its search index
	cd $(SITE) && npm run build

preview: ## Serve the built site
	cd $(SITE) && npm run preview

check: ## Type check
	cd $(SITE) && npm run check

clean:
	rm -rf $(SITE)/dist $(SITE)/node_modules/.astro
