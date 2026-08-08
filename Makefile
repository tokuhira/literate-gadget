NW      := $(wildcard gadgets/*/*.nw)
TANGLE  := ./tools/ntangle
WEAVE   := ./tools/nweave
WITNESS := ./tools/nwitness

.PHONY: all check clean witness

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

# 証拠の集計。既定は未証の節だけを出す。ALL=1 で全部出す。
# 平文の既定は「未証」なので、走らせなければ何も強制されない。
#
# VERIFY=1 で証言の裏取りもする（reference/ が要る）。引用が本当にその行に
# あるかを突き合わせるので、上流が変われば落ちる。証拠は風化する。
witness:
	@for f in $(NW); do $(WITNESS) $(if $(ALL),-a) $(if $(VERIFY),-v) $$f; done

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
