export class WalletsInMemory<T> {
  private readonly map: Map<string, T> = new Map();

  public remove(label: string): Promise<void> {
    this.map.delete(label);
    return Promise.resolve();
  }

  public get(label: string): Promise<T | undefined> {
    return Promise.resolve(this.map.get(label));
  }

  public list(): Promise<string[]> {
    return Promise.resolve(Array.from(this.map.keys()));
  }

  public put(label: string, data: T): Promise<void> {
    this.map.set(label, data);
    return Promise.resolve();
  }
}
