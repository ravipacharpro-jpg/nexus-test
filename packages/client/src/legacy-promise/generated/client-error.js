export class ClientError extends Error {
    reason;
    name = "ClientError";
    constructor(reason, options) {
        super(reason, options);
        this.reason = reason;
    }
}
