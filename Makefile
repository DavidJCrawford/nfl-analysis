# Ingest and build. See Docs/HANDOFF.md for where this is up to.
#
# Everything comes from nflverse, which publishes as GitHub release assets and
# refreshes nightly during the season. No key, no rate limit, no residential-IP
# problem — unlike the F1 project this was modelled on.

CACHE ?= .cache/nflverse
SITE  := site

.PHONY: help fetch emit verify data build links preview check clean

help:
	@grep -E '^[a-z-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "};{printf "  %-10s %s\n", $$1, $$2}'

fetch: ## Download the schedule and this season's play-by-play from nflverse
	python3 pipeline/fetch.py

emit: ## nflverse CSV -> canonical JSON in site/data/
	python3 pipeline/emit.py

verify: ## Check the emitted JSON against the published scores and drive summaries
	python3 pipeline/verify.py

data: fetch emit verify ## Full data refresh

build: verify ## Build the site and its search index, then check its links
	cd $(SITE) && npm run build
	python3 pipeline/check_site.py

links: ## Check the built site for links that go nowhere
	python3 pipeline/check_site.py

preview: ## Serve the built site
	cd $(SITE) && npm run preview

check: ## Type check
	cd $(SITE) && npm run check

clean:
	rm -rf $(SITE)/dist $(SITE)/node_modules/.astro
