import { Client, MediaUploadType, OAuth2Authenticator, type Post } from "mixi2-js";
import { apiAddress, MediaUploader, tokenUrl } from "mixi2-js/helpers";

export class Mixi2Client {
  readonly authenticator: OAuth2Authenticator;
  private readonly client: Client;
  private readonly uploader: MediaUploader;

  constructor(clientId: string, clientSecret: string) {
    this.authenticator = new OAuth2Authenticator({ clientId, clientSecret, tokenUrl });
    this.client = new Client({ apiAddress, authenticator: this.authenticator });
    this.uploader = new MediaUploader(this.client);
  }

  async createPost(text: string, mediaIdList: string[] = []): Promise<Post> {
    return this.client.createPost({
      text,
      ...(mediaIdList.length > 0 ? { mediaIdList } : {}),
    });
  }

  /** 画像をアップロードし、処理完了済みの mediaId を返す。 */
  async uploadImage(data: ArrayBuffer, contentType: string): Promise<string> {
    const { mediaId, uploadUrl } = await this.uploader.initiate({
      contentType,
      dataSize: data.byteLength,
      mediaType: MediaUploadType.IMAGE,
    });
    await this.uploader.upload(uploadUrl, data);
    return this.uploader.waitForReady(mediaId);
  }

  close(): void {
    this.client.close();
  }
}
