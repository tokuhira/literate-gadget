NW      := $(wildcard gadgets/*/*.nw)
TANGLE  := ./tools/ntangle
WEAVE   := ./tools/nweave

.PHONY: all check clean

all: tangle weave

tangle:
	@for f in $(NW); do \
	  d=$$(dirname $$f); \
	  for r in $$(grep -o '^<<[A-Za-z0-9_.-]*\.\(js\|css\|html\|md\)>>=' $$f | sed 's/^<<//;s/>>=$$//' | sort -u); do \
	    $(TANGLE) -r $$r $$f > $$d/$$r && echo "tangle  $$f -> $$d/$$r"; \
	  done; \
	done

weave:
	@for f in $(NW); do \
	  o=$${f%.nw}.html; \
	  $(WEAVE) $$f > $$o && echo "weave   $$f -> $$o"; \
	done

check:
	@if ! command -v node >/dev/null 2>&1; then \
	  echo "skip    node がないので構文検査は行わない"; \
	else \
	  for f in $(NW); do \
	    d=$$(dirname $$f); \
	    for j in $$d/*.js; do \
	      [ -e "$$j" ] || continue; \
	      cp $$j /tmp/_chk.mjs && node --check /tmp/_chk.mjs && echo "ok      $$j"; \
	    done; \
	  done; \
	fi

clean:
	@for f in $(NW); do rm -f $${f%.nw}.html $$(dirname $$f)/*.js; done
	@echo "cleaned"
