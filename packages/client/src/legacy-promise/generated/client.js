import { ClientError } from "./client-error";
const maxSseEventBytes = 16 * 1024 * 1024;
export function make(options) {
    const fetch = options.fetch ?? globalThis.fetch;
    const prepare = (descriptor, requestOptions) => {
        const url = new URL(descriptor.path, options.baseUrl);
        for (const [key, value] of Object.entries(descriptor.query ?? {}))
            appendQuery(url.searchParams, key, value);
        const headers = new Headers(options.headers);
        for (const [key, value] of Object.entries(descriptor.headers ?? {})) {
            if (value !== undefined && value !== null)
                headers.set(key, String(value));
        }
        for (const [key, value] of new Headers(requestOptions?.headers))
            headers.set(key, value);
        if (descriptor.body !== undefined && !headers.has("content-type"))
            headers.set("content-type", "application/json");
        return {
            url,
            init: {
                method: descriptor.method,
                signal: requestOptions?.signal,
                headers,
                body: descriptor.body === undefined ? undefined : JSON.stringify(descriptor.body),
            },
        };
    };
    const execute = async (descriptor, requestOptions) => {
        try {
            const prepared = prepare(descriptor, requestOptions);
            return await fetch(prepared.url, prepared.init);
        }
        catch (cause) {
            throw new ClientError("Transport", { cause });
        }
    };
    const responseError = async (response, descriptor) => {
        if (descriptor.declaredStatuses.includes(response.status))
            throw await json(response);
        try {
            await response.body?.cancel();
        }
        catch { }
        throw new ClientError("UnexpectedStatus", { cause: { status: response.status } });
    };
    const request = async (descriptor, requestOptions) => {
        const response = await execute(descriptor, requestOptions);
        if (response.status !== descriptor.successStatus)
            return responseError(response, descriptor);
        if (descriptor.binary)
            return new Uint8Array(await response.arrayBuffer());
        if (descriptor.empty) {
            try {
                await response.body?.cancel();
            }
            catch { }
            return undefined;
        }
        return (await json(response));
    };
    const sse = (descriptor, requestOptions) => ({
        async *[Symbol.asyncIterator]() {
            const response = await execute(descriptor, requestOptions);
            if (response.status !== descriptor.successStatus)
                await responseError(response, descriptor);
            if (!isContentType(response, "text/event-stream")) {
                try {
                    await response.body?.cancel();
                }
                catch { }
                throw new ClientError("UnsupportedContentType");
            }
            if (response.body === null)
                throw new ClientError("MalformedResponse");
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            try {
                while (true) {
                    let next;
                    try {
                        next = await reader.read();
                    }
                    catch (cause) {
                        throw new ClientError("Transport", { cause });
                    }
                    buffer += decoder.decode(next.value, { stream: !next.done });
                    if (buffer.length > maxSseEventBytes)
                        throw new ClientError("SseEventTooLarge");
                    const trailingCarriageReturn = !next.done && buffer.endsWith("\r");
                    if (trailingCarriageReturn)
                        buffer = buffer.slice(0, -1);
                    buffer = buffer.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
                    if (trailingCarriageReturn)
                        buffer += "\r";
                    if (next.done && buffer !== "")
                        buffer += "\n\n";
                    let boundary = buffer.indexOf("\n\n");
                    while (boundary >= 0) {
                        const block = buffer.slice(0, boundary);
                        buffer = buffer.slice(boundary + 2);
                        const data = block
                            .split("\n")
                            .flatMap((line) => (line.startsWith("data:") ? [line.slice(5).trimStart()] : []))
                            .join("\n");
                        if (data !== "") {
                            try {
                                yield JSON.parse(data);
                            }
                            catch (cause) {
                                throw new ClientError("MalformedResponse", { cause });
                            }
                        }
                        boundary = buffer.indexOf("\n\n");
                    }
                    if (next.done)
                        return;
                }
            }
            finally {
                try {
                    await reader.cancel();
                }
                catch { }
                reader.releaseLock();
            }
        },
    });
    return {
        health: {
            get: (requestOptions) => request({ method: "GET", path: `/api/health`, successStatus: 200, declaredStatuses: [401, 400], empty: false }, requestOptions),
            stop: (input, requestOptions) => request({
                method: "POST",
                path: `/api/service/stop`,
                body: { instanceID: input["instanceID"] },
                successStatus: 200,
                declaredStatuses: [401, 400],
                empty: false,
            }, requestOptions),
        },
        server: {
            get: (requestOptions) => request({ method: "GET", path: `/api/server`, successStatus: 200, declaredStatuses: [401, 400], empty: false }, requestOptions),
        },
        location: {
            get: (input, requestOptions) => request({
                method: "GET",
                path: `/api/location`,
                query: { location: input?.["location"] },
                successStatus: 200,
                declaredStatuses: [401, 400],
                empty: false,
            }, requestOptions),
        },
        agent: {
            list: (input, requestOptions) => request({
                method: "GET",
                path: `/api/agent`,
                query: { location: input?.["location"] },
                successStatus: 200,
                declaredStatuses: [401, 400],
                empty: false,
            }, requestOptions),
        },
        plugin: {
            list: (input, requestOptions) => request({
                method: "GET",
                path: `/api/plugin`,
                query: { location: input?.["location"] },
                successStatus: 200,
                declaredStatuses: [401, 400],
                empty: false,
            }, requestOptions),
        },
        session: {
            list: (input, requestOptions) => request({
                method: "GET",
                path: `/api/session`,
                query: {
                    workspace: input?.["workspace"],
                    limit: input?.["limit"],
                    order: input?.["order"],
                    search: input?.["search"],
                    parentID: input?.["parentID"],
                    directory: input?.["directory"],
                    project: input?.["project"],
                    subpath: input?.["subpath"],
                    cursor: input?.["cursor"],
                },
                successStatus: 200,
                declaredStatuses: [400, 401],
                empty: false,
            }, requestOptions),
            create: (input, requestOptions) => request({
                method: "POST",
                path: `/api/session`,
                body: {
                    id: input?.["id"],
                    agent: input?.["agent"],
                    model: input?.["model"],
                    location: input?.["location"],
                },
                successStatus: 200,
                declaredStatuses: [401, 400],
                empty: false,
            }, requestOptions).then((value) => value.data),
            active: (requestOptions) => request({
                method: "GET",
                path: `/api/session/active`,
                successStatus: 200,
                declaredStatuses: [401, 400],
                empty: false,
            }, requestOptions).then((value) => value.data),
            get: (input, requestOptions) => request({
                method: "GET",
                path: `/api/session/${encodeURIComponent(input.sessionID)}`,
                successStatus: 200,
                declaredStatuses: [404, 400, 401],
                empty: false,
            }, requestOptions).then((value) => value.data),
            remove: (input, requestOptions) => request({
                method: "DELETE",
                path: `/api/session/${encodeURIComponent(input.sessionID)}`,
                successStatus: 204,
                declaredStatuses: [404, 400, 401],
                empty: true,
            }, requestOptions),
            fork: (input, requestOptions) => request({
                method: "POST",
                path: `/api/session/${encodeURIComponent(input.sessionID)}/fork`,
                body: { messageID: input["messageID"] },
                successStatus: 200,
                declaredStatuses: [404, 400, 401],
                empty: false,
            }, requestOptions).then((value) => value.data),
            switchAgent: (input, requestOptions) => request({
                method: "POST",
                path: `/api/session/${encodeURIComponent(input.sessionID)}/agent`,
                body: { agent: input["agent"] },
                successStatus: 204,
                declaredStatuses: [404, 400, 401],
                empty: true,
            }, requestOptions),
            switchModel: (input, requestOptions) => request({
                method: "POST",
                path: `/api/session/${encodeURIComponent(input.sessionID)}/model`,
                body: { model: input["model"] },
                successStatus: 204,
                declaredStatuses: [404, 400, 401],
                empty: true,
            }, requestOptions),
            rename: (input, requestOptions) => request({
                method: "POST",
                path: `/api/session/${encodeURIComponent(input.sessionID)}/rename`,
                body: { title: input["title"] },
                successStatus: 204,
                declaredStatuses: [404, 400, 401],
                empty: true,
            }, requestOptions),
            move: (input, requestOptions) => request({
                method: "POST",
                path: `/api/session/${encodeURIComponent(input.sessionID)}/move`,
                body: { directory: input["directory"], workspaceID: input["workspaceID"] },
                successStatus: 204,
                declaredStatuses: [404, 400, 401],
                empty: true,
            }, requestOptions),
            prompt: (input, requestOptions) => request({
                method: "POST",
                path: `/api/session/${encodeURIComponent(input.sessionID)}/prompt`,
                body: {
                    id: input["id"],
                    text: input["text"],
                    files: input["files"],
                    agents: input["agents"],
                    metadata: input["metadata"],
                    delivery: input["delivery"],
                    resume: input["resume"],
                },
                successStatus: 200,
                declaredStatuses: [409, 400, 404, 401],
                empty: false,
            }, requestOptions).then((value) => value.data),
            command: (input, requestOptions) => request({
                method: "POST",
                path: `/api/session/${encodeURIComponent(input.sessionID)}/command`,
                body: {
                    id: input["id"],
                    command: input["command"],
                    arguments: input["arguments"],
                    agent: input["agent"],
                    model: input["model"],
                    files: input["files"],
                    agents: input["agents"],
                    delivery: input["delivery"],
                    resume: input["resume"],
                },
                successStatus: 200,
                declaredStatuses: [409, 400, 404, 500, 401],
                empty: false,
            }, requestOptions).then((value) => value.data),
            skill: (input, requestOptions) => request({
                method: "POST",
                path: `/api/session/${encodeURIComponent(input.sessionID)}/skill`,
                body: { id: input["id"], skill: input["skill"], resume: input["resume"] },
                successStatus: 204,
                declaredStatuses: [404, 400, 401],
                empty: true,
            }, requestOptions),
            synthetic: (input, requestOptions) => request({
                method: "POST",
                path: `/api/session/${encodeURIComponent(input.sessionID)}/synthetic`,
                body: {
                    id: input["id"],
                    text: input["text"],
                    description: input["description"],
                    metadata: input["metadata"],
                    delivery: input["delivery"],
                    resume: input["resume"],
                },
                successStatus: 200,
                declaredStatuses: [409, 404, 400, 401],
                empty: false,
            }, requestOptions).then((value) => value.data),
            shell: (input, requestOptions) => request({
                method: "POST",
                path: `/api/session/${encodeURIComponent(input.sessionID)}/shell`,
                body: { id: input["id"], command: input["command"] },
                successStatus: 204,
                declaredStatuses: [404, 400, 401],
                empty: true,
            }, requestOptions),
            compact: (input, requestOptions) => request({
                method: "POST",
                path: `/api/session/${encodeURIComponent(input.sessionID)}/compact`,
                body: { id: input["id"] },
                successStatus: 200,
                declaredStatuses: [409, 404, 400, 401],
                empty: false,
            }, requestOptions).then((value) => value.data),
            wait: (input, requestOptions) => request({
                method: "POST",
                path: `/api/session/${encodeURIComponent(input.sessionID)}/wait`,
                successStatus: 204,
                declaredStatuses: [404, 503, 400, 401],
                empty: true,
            }, requestOptions),
            revert: {
                stage: (input, requestOptions) => request({
                    method: "POST",
                    path: `/api/session/${encodeURIComponent(input.sessionID)}/revert/stage`,
                    body: { messageID: input["messageID"], files: input["files"] },
                    successStatus: 200,
                    declaredStatuses: [404, 409, 500, 400, 401],
                    empty: false,
                }, requestOptions).then((value) => value.data),
                clear: (input, requestOptions) => request({
                    method: "POST",
                    path: `/api/session/${encodeURIComponent(input.sessionID)}/revert/clear`,
                    successStatus: 204,
                    declaredStatuses: [404, 409, 500, 400, 401],
                    empty: true,
                }, requestOptions),
                commit: (input, requestOptions) => request({
                    method: "POST",
                    path: `/api/session/${encodeURIComponent(input.sessionID)}/revert/commit`,
                    successStatus: 204,
                    declaredStatuses: [404, 409, 400, 401],
                    empty: true,
                }, requestOptions),
            },
            context: (input, requestOptions) => request({
                method: "GET",
                path: `/api/session/${encodeURIComponent(input.sessionID)}/context`,
                successStatus: 200,
                declaredStatuses: [404, 500, 400, 401],
                empty: false,
            }, requestOptions).then((value) => value.data),
            pending: {
                list: (input, requestOptions) => request({
                    method: "GET",
                    path: `/api/session/${encodeURIComponent(input.sessionID)}/pending`,
                    successStatus: 200,
                    declaredStatuses: [404, 400, 401],
                    empty: false,
                }, requestOptions).then((value) => value.data),
            },
            instructions: {
                entry: {
                    list: (input, requestOptions) => request({
                        method: "GET",
                        path: `/api/session/${encodeURIComponent(input.sessionID)}/instructions/entries`,
                        successStatus: 200,
                        declaredStatuses: [404, 400, 401],
                        empty: false,
                    }, requestOptions).then((value) => value.data),
                    put: (input, requestOptions) => request({
                        method: "PUT",
                        path: `/api/session/${encodeURIComponent(input.sessionID)}/instructions/entries/${encodeURIComponent(input.key)}`,
                        body: { value: input["value"] },
                        successStatus: 204,
                        declaredStatuses: [404, 413, 400, 401],
                        empty: true,
                    }, requestOptions),
                    remove: (input, requestOptions) => request({
                        method: "DELETE",
                        path: `/api/session/${encodeURIComponent(input.sessionID)}/instructions/entries/${encodeURIComponent(input.key)}`,
                        successStatus: 204,
                        declaredStatuses: [404, 400, 401],
                        empty: true,
                    }, requestOptions),
                },
            },
            generate: (input, requestOptions) => request({
                method: "POST",
                path: `/api/session/${encodeURIComponent(input.sessionID)}/generate`,
                body: { prompt: input["prompt"] },
                successStatus: 200,
                declaredStatuses: [404, 503, 400, 401],
                empty: false,
            }, requestOptions).then((value) => value.data),
            log: (input, requestOptions) => sse({
                method: "GET",
                path: `/api/experimental/session/${encodeURIComponent(input.sessionID)}/log`,
                query: { after: input["after"], follow: input["follow"] },
                successStatus: 200,
                declaredStatuses: [404, 400, 401],
                empty: false,
            }, requestOptions),
            interrupt: (input, requestOptions) => request({
                method: "POST",
                path: `/api/session/${encodeURIComponent(input.sessionID)}/interrupt`,
                successStatus: 204,
                declaredStatuses: [404, 400, 401],
                empty: true,
            }, requestOptions),
            background: (input, requestOptions) => request({
                method: "POST",
                path: `/api/session/${encodeURIComponent(input.sessionID)}/background`,
                successStatus: 204,
                declaredStatuses: [404, 400, 401],
                empty: true,
            }, requestOptions),
            message: (input, requestOptions) => request({
                method: "GET",
                path: `/api/session/${encodeURIComponent(input.sessionID)}/message/${encodeURIComponent(input.messageID)}`,
                successStatus: 200,
                declaredStatuses: [404, 400, 401],
                empty: false,
            }, requestOptions).then((value) => value.data),
        },
        message: {
            list: (input, requestOptions) => request({
                method: "GET",
                path: `/api/session/${encodeURIComponent(input.sessionID)}/message`,
                query: { limit: input["limit"], order: input["order"], cursor: input["cursor"] },
                successStatus: 200,
                declaredStatuses: [400, 404, 500, 401],
                empty: false,
            }, requestOptions),
        },
        model: {
            list: (input, requestOptions) => request({
                method: "GET",
                path: `/api/model`,
                query: { location: input?.["location"] },
                successStatus: 200,
                declaredStatuses: [503, 401, 400],
                empty: false,
            }, requestOptions),
            default: (input, requestOptions) => request({
                method: "GET",
                path: `/api/model/default`,
                query: { location: input?.["location"] },
                successStatus: 200,
                declaredStatuses: [503, 401, 400],
                empty: false,
            }, requestOptions),
        },
        generate: {
            text: (input, requestOptions) => request({
                method: "POST",
                path: `/api/generate`,
                query: { location: input["location"] },
                body: { prompt: input["prompt"], model: input["model"] },
                successStatus: 200,
                declaredStatuses: [400, 503, 401],
                empty: false,
            }, requestOptions).then((value) => value.data),
        },
        provider: {
            list: (input, requestOptions) => request({
                method: "GET",
                path: `/api/provider`,
                query: { location: input?.["location"] },
                successStatus: 200,
                declaredStatuses: [503, 401, 400],
                empty: false,
            }, requestOptions),
            get: (input, requestOptions) => request({
                method: "GET",
                path: `/api/provider/${encodeURIComponent(input.providerID)}`,
                query: { location: input["location"] },
                successStatus: 200,
                declaredStatuses: [404, 503, 401, 400],
                empty: false,
            }, requestOptions),
        },
        integration: {
            list: (input, requestOptions) => request({
                method: "GET",
                path: `/api/integration`,
                query: { location: input?.["location"] },
                successStatus: 200,
                declaredStatuses: [401, 400],
                empty: false,
            }, requestOptions),
            get: (input, requestOptions) => request({
                method: "GET",
                path: `/api/integration/${encodeURIComponent(input.integrationID)}`,
                query: { location: input["location"] },
                successStatus: 200,
                declaredStatuses: [401, 400],
                empty: false,
            }, requestOptions),
            wellknown: {
                add: (input, requestOptions) => request({
                    method: "POST",
                    path: `/api/experimental/integration/wellknown`,
                    query: { location: input["location"] },
                    body: { url: input["url"] },
                    successStatus: 204,
                    declaredStatuses: [400, 401],
                    empty: true,
                }, requestOptions),
            },
            connect: {
                key: (input, requestOptions) => request({
                    method: "POST",
                    path: `/api/integration/${encodeURIComponent(input.integrationID)}/connect/key`,
                    query: { location: input["location"] },
                    body: { key: input["key"], label: input["label"] },
                    successStatus: 204,
                    declaredStatuses: [400, 401],
                    empty: true,
                }, requestOptions),
            },
            oauth: {
                connect: (input, requestOptions) => request({
                    method: "POST",
                    path: `/api/integration/${encodeURIComponent(input.integrationID)}/connect/oauth`,
                    query: { location: input["location"] },
                    body: { methodID: input["methodID"], inputs: input["inputs"], label: input["label"] },
                    successStatus: 200,
                    declaredStatuses: [400, 401],
                    empty: false,
                }, requestOptions),
                status: (input, requestOptions) => request({
                    method: "GET",
                    path: `/api/integration/${encodeURIComponent(input.integrationID)}/connect/oauth/${encodeURIComponent(input.attemptID)}`,
                    query: { location: input["location"] },
                    successStatus: 200,
                    declaredStatuses: [401, 400],
                    empty: false,
                }, requestOptions),
                complete: (input, requestOptions) => request({
                    method: "POST",
                    path: `/api/integration/${encodeURIComponent(input.integrationID)}/connect/oauth/${encodeURIComponent(input.attemptID)}/complete`,
                    query: { location: input["location"] },
                    body: { code: input["code"] },
                    successStatus: 204,
                    declaredStatuses: [400, 401],
                    empty: true,
                }, requestOptions),
                cancel: (input, requestOptions) => request({
                    method: "DELETE",
                    path: `/api/integration/${encodeURIComponent(input.integrationID)}/connect/oauth/${encodeURIComponent(input.attemptID)}`,
                    query: { location: input["location"] },
                    successStatus: 204,
                    declaredStatuses: [401, 400],
                    empty: true,
                }, requestOptions),
            },
            command: {
                connect: (input, requestOptions) => request({
                    method: "POST",
                    path: `/api/integration/${encodeURIComponent(input.integrationID)}/connect/command`,
                    query: { location: input["location"] },
                    body: { methodID: input["methodID"], label: input["label"] },
                    successStatus: 200,
                    declaredStatuses: [400, 401],
                    empty: false,
                }, requestOptions),
                status: (input, requestOptions) => request({
                    method: "GET",
                    path: `/api/integration/${encodeURIComponent(input.integrationID)}/connect/command/${encodeURIComponent(input.attemptID)}`,
                    query: { location: input["location"] },
                    successStatus: 200,
                    declaredStatuses: [401, 400],
                    empty: false,
                }, requestOptions),
                cancel: (input, requestOptions) => request({
                    method: "DELETE",
                    path: `/api/integration/${encodeURIComponent(input.integrationID)}/connect/command/${encodeURIComponent(input.attemptID)}`,
                    query: { location: input["location"] },
                    successStatus: 204,
                    declaredStatuses: [401, 400],
                    empty: true,
                }, requestOptions),
            },
        },
        mcp: {
            list: (input, requestOptions) => request({
                method: "GET",
                path: `/api/mcp`,
                query: { location: input?.["location"] },
                successStatus: 200,
                declaredStatuses: [401, 400],
                empty: false,
            }, requestOptions),
            add: (input, requestOptions) => request({
                method: "PUT",
                path: `/api/mcp/${encodeURIComponent(input.server)}`,
                query: { location: input["location"] },
                body: { config: input["config"] },
                successStatus: 204,
                declaredStatuses: [401, 400],
                empty: true,
            }, requestOptions),
            remove: (input, requestOptions) => request({
                method: "DELETE",
                path: `/api/mcp/${encodeURIComponent(input.server)}`,
                query: { location: input["location"] },
                successStatus: 204,
                declaredStatuses: [404, 401, 400],
                empty: true,
            }, requestOptions),
            connect: (input, requestOptions) => request({
                method: "POST",
                path: `/api/mcp/${encodeURIComponent(input.server)}/connect`,
                query: { location: input["location"] },
                successStatus: 204,
                declaredStatuses: [404, 401, 400],
                empty: true,
            }, requestOptions),
            disconnect: (input, requestOptions) => request({
                method: "POST",
                path: `/api/mcp/${encodeURIComponent(input.server)}/disconnect`,
                query: { location: input["location"] },
                successStatus: 204,
                declaredStatuses: [404, 401, 400],
                empty: true,
            }, requestOptions),
            resource: {
                catalog: (input, requestOptions) => request({
                    method: "GET",
                    path: `/api/mcp/resource`,
                    query: { location: input?.["location"] },
                    successStatus: 200,
                    declaredStatuses: [401, 400],
                    empty: false,
                }, requestOptions),
            },
        },
        credential: {
            update: (input, requestOptions) => request({
                method: "PATCH",
                path: `/api/credential/${encodeURIComponent(input.credentialID)}`,
                query: { location: input["location"] },
                body: { label: input["label"] },
                successStatus: 204,
                declaredStatuses: [401, 400],
                empty: true,
            }, requestOptions),
            remove: (input, requestOptions) => request({
                method: "DELETE",
                path: `/api/credential/${encodeURIComponent(input.credentialID)}`,
                query: { location: input["location"] },
                successStatus: 204,
                declaredStatuses: [401, 400],
                empty: true,
            }, requestOptions),
        },
        project: {
            list: (requestOptions) => request({ method: "GET", path: `/api/project`, successStatus: 200, declaredStatuses: [401, 400], empty: false }, requestOptions),
            current: (input, requestOptions) => request({
                method: "GET",
                path: `/api/project/current`,
                query: { location: input?.["location"] },
                successStatus: 200,
                declaredStatuses: [401, 400],
                empty: false,
            }, requestOptions),
            directories: (input, requestOptions) => request({
                method: "GET",
                path: `/api/project/${encodeURIComponent(input.projectID)}/directories`,
                query: { location: input["location"] },
                successStatus: 200,
                declaredStatuses: [401, 400],
                empty: false,
            }, requestOptions),
        },
        form: {
            request: {
                list: (input, requestOptions) => request({
                    method: "GET",
                    path: `/api/form/request`,
                    query: { location: input?.["location"] },
                    successStatus: 200,
                    declaredStatuses: [401, 400],
                    empty: false,
                }, requestOptions),
            },
            list: (input, requestOptions) => request({
                method: "GET",
                path: `/api/session/${encodeURIComponent(input.sessionID)}/form`,
                successStatus: 200,
                declaredStatuses: [404, 400, 401],
                empty: false,
            }, requestOptions).then((value) => value.data),
            create: (input, requestOptions) => request({
                method: "POST",
                path: `/api/session/${encodeURIComponent(input.sessionID)}/form`,
                body: { id: input["id"], title: input["title"], metadata: input["metadata"], fields: input["fields"] },
                successStatus: 200,
                declaredStatuses: [404, 409, 400, 401],
                empty: false,
            }, requestOptions).then((value) => value.data),
            get: (input, requestOptions) => request({
                method: "GET",
                path: `/api/session/${encodeURIComponent(input.sessionID)}/form/${encodeURIComponent(input.formID)}`,
                successStatus: 200,
                declaredStatuses: [404, 400, 401],
                empty: false,
            }, requestOptions).then((value) => value.data),
            state: (input, requestOptions) => request({
                method: "GET",
                path: `/api/session/${encodeURIComponent(input.sessionID)}/form/${encodeURIComponent(input.formID)}/state`,
                successStatus: 200,
                declaredStatuses: [404, 400, 401],
                empty: false,
            }, requestOptions).then((value) => value.data),
            reply: (input, requestOptions) => request({
                method: "POST",
                path: `/api/session/${encodeURIComponent(input.sessionID)}/form/${encodeURIComponent(input.formID)}/reply`,
                body: { answer: input["answer"] },
                successStatus: 204,
                declaredStatuses: [404, 409, 400, 401],
                empty: true,
            }, requestOptions),
            cancel: (input, requestOptions) => request({
                method: "POST",
                path: `/api/session/${encodeURIComponent(input.sessionID)}/form/${encodeURIComponent(input.formID)}/cancel`,
                successStatus: 204,
                declaredStatuses: [404, 409, 400, 401],
                empty: true,
            }, requestOptions),
        },
        permission: {
            request: {
                list: (input, requestOptions) => request({
                    method: "GET",
                    path: `/api/permission/request`,
                    query: { location: input?.["location"] },
                    successStatus: 200,
                    declaredStatuses: [401, 400],
                    empty: false,
                }, requestOptions),
            },
            saved: {
                list: (input, requestOptions) => request({
                    method: "GET",
                    path: `/api/permission/saved`,
                    query: { projectID: input?.["projectID"] },
                    successStatus: 200,
                    declaredStatuses: [401, 400],
                    empty: false,
                }, requestOptions).then((value) => value.data),
                remove: (input, requestOptions) => request({
                    method: "DELETE",
                    path: `/api/permission/saved/${encodeURIComponent(input.id)}`,
                    successStatus: 204,
                    declaredStatuses: [401, 400],
                    empty: true,
                }, requestOptions),
            },
            create: (input, requestOptions) => request({
                method: "POST",
                path: `/api/session/${encodeURIComponent(input.sessionID)}/permission`,
                body: {
                    id: input["id"],
                    action: input["action"],
                    resources: input["resources"],
                    save: input["save"],
                    metadata: input["metadata"],
                    source: input["source"],
                    agent: input["agent"],
                },
                successStatus: 200,
                declaredStatuses: [404, 400, 401],
                empty: false,
            }, requestOptions).then((value) => value.data),
            list: (input, requestOptions) => request({
                method: "GET",
                path: `/api/session/${encodeURIComponent(input.sessionID)}/permission`,
                successStatus: 200,
                declaredStatuses: [404, 400, 401],
                empty: false,
            }, requestOptions).then((value) => value.data),
            get: (input, requestOptions) => request({
                method: "GET",
                path: `/api/session/${encodeURIComponent(input.sessionID)}/permission/${encodeURIComponent(input.requestID)}`,
                successStatus: 200,
                declaredStatuses: [404, 400, 401],
                empty: false,
            }, requestOptions).then((value) => value.data),
            reply: (input, requestOptions) => request({
                method: "POST",
                path: `/api/session/${encodeURIComponent(input.sessionID)}/permission/${encodeURIComponent(input.requestID)}/reply`,
                body: { reply: input["reply"], message: input["message"] },
                successStatus: 204,
                declaredStatuses: [404, 400, 401],
                empty: true,
            }, requestOptions),
        },
        file: {
            read: (input, requestOptions) => request({
                method: "GET",
                path: `/api/fs/read/${encodePath(input.path)}`,
                query: { location: input["location"] },
                successStatus: 200,
                declaredStatuses: [401, 400],
                empty: false,
                binary: true,
            }, requestOptions),
            list: (input, requestOptions) => request({
                method: "GET",
                path: `/api/fs/list`,
                query: { location: input?.["location"], path: input?.["path"] },
                successStatus: 200,
                declaredStatuses: [401, 400],
                empty: false,
            }, requestOptions),
            find: (input, requestOptions) => request({
                method: "GET",
                path: `/api/fs/find`,
                query: { location: input["location"], query: input["query"], type: input["type"], limit: input["limit"] },
                successStatus: 200,
                declaredStatuses: [401, 400],
                empty: false,
            }, requestOptions),
        },
        command: {
            list: (input, requestOptions) => request({
                method: "GET",
                path: `/api/command`,
                query: { location: input?.["location"] },
                successStatus: 200,
                declaredStatuses: [401, 400],
                empty: false,
            }, requestOptions),
        },
        skill: {
            list: (input, requestOptions) => request({
                method: "GET",
                path: `/api/skill`,
                query: { location: input?.["location"] },
                successStatus: 200,
                declaredStatuses: [401, 400],
                empty: false,
            }, requestOptions),
        },
        event: {
            subscribe: (requestOptions) => sse({ method: "GET", path: `/api/event`, successStatus: 200, declaredStatuses: [401, 400], empty: false }, requestOptions),
        },
        pty: {
            list: (input, requestOptions) => request({
                method: "GET",
                path: `/api/pty`,
                query: { location: input?.["location"] },
                successStatus: 200,
                declaredStatuses: [401, 400],
                empty: false,
            }, requestOptions),
            create: (input, requestOptions) => request({
                method: "POST",
                path: `/api/pty`,
                query: { location: input?.["location"] },
                body: {
                    command: input?.["command"],
                    args: input?.["args"],
                    cwd: input?.["cwd"],
                    title: input?.["title"],
                    env: input?.["env"],
                },
                successStatus: 200,
                declaredStatuses: [401, 400],
                empty: false,
            }, requestOptions),
            get: (input, requestOptions) => request({
                method: "GET",
                path: `/api/pty/${encodeURIComponent(input.ptyID)}`,
                query: { location: input["location"] },
                successStatus: 200,
                declaredStatuses: [404, 401, 400],
                empty: false,
            }, requestOptions),
            update: (input, requestOptions) => request({
                method: "PUT",
                path: `/api/pty/${encodeURIComponent(input.ptyID)}`,
                query: { location: input["location"] },
                body: { title: input["title"], size: input["size"] },
                successStatus: 200,
                declaredStatuses: [404, 401, 400],
                empty: false,
            }, requestOptions),
            remove: (input, requestOptions) => request({
                method: "DELETE",
                path: `/api/pty/${encodeURIComponent(input.ptyID)}`,
                query: { location: input["location"] },
                successStatus: 204,
                declaredStatuses: [404, 401, 400],
                empty: true,
            }, requestOptions),
        },
        shell: {
            list: (input, requestOptions) => request({
                method: "GET",
                path: `/api/shell`,
                query: { location: input?.["location"] },
                successStatus: 200,
                declaredStatuses: [401, 400],
                empty: false,
            }, requestOptions),
            create: (input, requestOptions) => request({
                method: "POST",
                path: `/api/shell`,
                query: { location: input["location"] },
                body: {
                    command: input["command"],
                    cwd: input["cwd"],
                    timeout: input["timeout"],
                    metadata: input["metadata"],
                },
                successStatus: 200,
                declaredStatuses: [401, 400],
                empty: false,
            }, requestOptions),
            get: (input, requestOptions) => request({
                method: "GET",
                path: `/api/shell/${encodeURIComponent(input.id)}`,
                query: { location: input["location"] },
                successStatus: 200,
                declaredStatuses: [404, 401, 400],
                empty: false,
            }, requestOptions),
            timeout: (input, requestOptions) => request({
                method: "PATCH",
                path: `/api/shell/${encodeURIComponent(input.id)}/timeout`,
                query: { location: input["location"] },
                body: { timeout: input["timeout"] },
                successStatus: 200,
                declaredStatuses: [404, 401, 400],
                empty: false,
            }, requestOptions),
            output: (input, requestOptions) => request({
                method: "GET",
                path: `/api/shell/${encodeURIComponent(input.id)}/output`,
                query: { location: input["location"], cursor: input["cursor"], limit: input["limit"] },
                successStatus: 200,
                declaredStatuses: [404, 401, 400],
                empty: false,
            }, requestOptions),
            remove: (input, requestOptions) => request({
                method: "DELETE",
                path: `/api/shell/${encodeURIComponent(input.id)}`,
                query: { location: input["location"] },
                successStatus: 204,
                declaredStatuses: [404, 401, 400],
                empty: true,
            }, requestOptions),
        },
        question: {
            request: {
                list: (input, requestOptions) => request({
                    method: "GET",
                    path: `/api/question/request`,
                    query: { location: input?.["location"] },
                    successStatus: 200,
                    declaredStatuses: [401, 400],
                    empty: false,
                }, requestOptions),
            },
            list: (input, requestOptions) => request({
                method: "GET",
                path: `/api/session/${encodeURIComponent(input.sessionID)}/question`,
                successStatus: 200,
                declaredStatuses: [404, 400, 401],
                empty: false,
            }, requestOptions).then((value) => value.data),
            reply: (input, requestOptions) => request({
                method: "POST",
                path: `/api/session/${encodeURIComponent(input.sessionID)}/question/${encodeURIComponent(input.requestID)}/reply`,
                body: { answers: input["answers"] },
                successStatus: 204,
                declaredStatuses: [404, 400, 401],
                empty: true,
            }, requestOptions),
            reject: (input, requestOptions) => request({
                method: "POST",
                path: `/api/session/${encodeURIComponent(input.sessionID)}/question/${encodeURIComponent(input.requestID)}/reject`,
                successStatus: 204,
                declaredStatuses: [404, 400, 401],
                empty: true,
            }, requestOptions),
        },
        reference: {
            list: (input, requestOptions) => request({
                method: "GET",
                path: `/api/reference`,
                query: { location: input?.["location"] },
                successStatus: 200,
                declaredStatuses: [401, 400],
                empty: false,
            }, requestOptions),
        },
        projectCopy: {
            create: (input, requestOptions) => request({
                method: "POST",
                path: `/experimental/project/${encodeURIComponent(input.projectID)}/copy`,
                query: { location: input["location"] },
                body: { strategy: input["strategy"], directory: input["directory"], name: input["name"] },
                successStatus: 200,
                declaredStatuses: [400, 401],
                empty: false,
            }, requestOptions),
            remove: (input, requestOptions) => request({
                method: "DELETE",
                path: `/experimental/project/${encodeURIComponent(input.projectID)}/copy`,
                query: { location: input["location"] },
                body: { directory: input["directory"], force: input["force"] },
                successStatus: 204,
                declaredStatuses: [400, 401],
                empty: true,
            }, requestOptions),
            refresh: (input, requestOptions) => request({
                method: "POST",
                path: `/experimental/project/${encodeURIComponent(input.projectID)}/copy/refresh`,
                query: { location: input["location"] },
                successStatus: 204,
                declaredStatuses: [400, 401],
                empty: true,
            }, requestOptions),
        },
        vcs: {
            status: (input, requestOptions) => request({
                method: "GET",
                path: `/api/vcs/status`,
                query: { location: input?.["location"] },
                successStatus: 200,
                declaredStatuses: [401, 400],
                empty: false,
            }, requestOptions),
            diff: (input, requestOptions) => request({
                method: "GET",
                path: `/api/vcs/diff`,
                query: { location: input["location"], mode: input["mode"], context: input["context"] },
                successStatus: 200,
                declaredStatuses: [401, 400],
                empty: false,
            }, requestOptions),
        },
        debug: {
            location: {
                list: (requestOptions) => request({
                    method: "GET",
                    path: `/api/debug/location`,
                    successStatus: 200,
                    declaredStatuses: [401, 400],
                    empty: false,
                }, requestOptions),
                evict: (input, requestOptions) => request({
                    method: "DELETE",
                    path: `/api/debug/location`,
                    query: { location: input?.["location"] },
                    successStatus: 204,
                    declaredStatuses: [401, 400],
                    empty: true,
                }, requestOptions),
            },
        },
    };
}
function encodePath(value) {
    return value.split("/").map(encodeURIComponent).join("/");
}
function appendQuery(params, key, value) {
    if (value === undefined)
        return;
    if (value === null) {
        params.append(key, "null");
        return;
    }
    if (Array.isArray(value)) {
        for (const item of value)
            appendQuery(params, key, item);
        return;
    }
    if (typeof value === "object") {
        for (const [child, item] of Object.entries(value))
            appendQuery(params, `${key}[${child}]`, item);
        return;
    }
    params.append(key, String(value));
}
async function json(response) {
    if (!isContentType(response, "application/json") && !response.headers.get("content-type")?.includes("+json")) {
        try {
            await response.body?.cancel();
        }
        catch { }
        throw new ClientError("UnsupportedContentType");
    }
    let text;
    try {
        text = await response.text();
    }
    catch (cause) {
        throw new ClientError("Transport", { cause });
    }
    if (text === "")
        throw new ClientError("MalformedResponse");
    try {
        return JSON.parse(text);
    }
    catch (cause) {
        throw new ClientError("MalformedResponse", { cause });
    }
}
function isContentType(response, expected) {
    return response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() === expected;
}
