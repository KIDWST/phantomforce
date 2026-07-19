import cloud_client
import ollama_client


def route_chat(messages, on_delta, mode="general", on_fallback=None, cloud_model=None, local_model=None, local_endpoint=None):
    """Cloud-preferred, local-guaranteed chat routing. Tries the configured
    cloud provider first; on ANY failure (no key, network error, HTTP
    error, timeout, rate limit) falls back to the local Ollama-backed
    model so the caller never hard-fails for lack of a subscription.

    mode="general" routes to the free PhantomPT local slot (no uncensored
    requirement). mode="unleashed" routes to the paywalled Unleashed local
    slot and requires an uncensored-marked model.

    on_fallback(reason: str), if provided, is called whenever the local
    path is taken instead of cloud, so a UI can show a status indicator
    without treating it as an error.
    """
    if mode == "unleashed":
        # Unleashed is the paywalled uncensored-local feature. Cloud
        # providers today only offer censored models (e.g. gpt-4o-mini), so
        # routing unleashed requests through cloud would silently defeat the
        # feature with no error and no fallback ever firing. Stay local-only
        # here until a future phase defines an uncensored-capable provider.
        if on_fallback:
            try:
                on_fallback("unleashed mode is local-only in this phase")
            except Exception:
                pass
    elif cloud_client.is_configured():
        try:
            return cloud_client.stream_chat(messages, on_delta, model=cloud_model)
        except Exception as exc:
            if on_fallback:
                try:
                    on_fallback(str(exc))
                except Exception:
                    pass
    elif on_fallback:
        try:
            on_fallback("no cloud provider configured")
        except Exception:
            pass

    endpoint = local_endpoint or ollama_client.default_endpoint()
    require_unleashed = mode == "unleashed"
    model = local_model or (ollama_client.MODEL if require_unleashed else default_general_model())
    return ollama_client.stream_chat(
        endpoint,
        model,
        messages,
        on_delta,
        require_unleashed=require_unleashed,
    )


def default_general_model():
    import os
    return os.environ.get("PHANTOMPT_MODEL", "llama3.1:8b")
