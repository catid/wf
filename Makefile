UV ?= uv
VENV ?= .venv
PYTHON ?= $(VENV)/bin/python

.PHONY: venv install run clean

venv:
	$(UV) venv $(VENV)

install: venv
	$(UV) pip install --python $(PYTHON) -r requirements.txt

run: install
	$(UV) run --python $(PYTHON) server.py

clean:
	rm -rf $(VENV)
