---
alwaysApply: true
---

All asynchronous API endpoints that process sensitive data MUST follow the established architectural pattern:
1.  **API Controller:** The controller is lightweight. Its primary role is to call `IKmsService.decodeRequest()` on the incoming payload.
2.  **Job Queuing:** After decoding, the controller places the resulting job into a queue and immediately returns a `202 Accepted` response, including the `thid` from the decoded job for correlation.
3.  **Worker:** A separate Worker process dequeues and executes the job's business logic.
4.  **Response Encoding:** Upon completion, the Worker MUST call `IKmsService.encodeResponse()` to encrypt the job result for the intended recipient(s).
5.  **Response Storage:** The Worker stores the encrypted response in a temporary key-value store (e.g., Redis, Firestore), using the `thid` as the key.
6.  **Polling:** A separate polling endpoint is responsible for retrieving the stored, encrypted response when requested by the original client using the `thid`.