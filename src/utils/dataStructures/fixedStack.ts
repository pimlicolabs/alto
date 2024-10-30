export class FixedStack<T> {
    private items: T[]
    private readonly maxCapacity: number

    constructor(maxCapacity: number) {
        if (maxCapacity <= 0) {
            throw new Error("Stack size must be greater than 0")
        }
        this.items = []
        this.maxCapacity = maxCapacity
    }

    push(item: T): void {
        if (this.isFull()) {
            // Remove the oldest element (first element)
            this.items.shift()
        }
        this.items.push(item)
    }

    pop(): T | undefined {
        if (this.isEmpty()) {
            return undefined
        }
        return this.items.shift()
    }

    peek(): T | null {
        if (this.isEmpty()) {
            return null
        }
        return this.items[this.items.length - 1]
    }

    isEmpty(): boolean {
        return this.items.length === 0
    }

    isFull(): boolean {
        return this.items.length === this.maxCapacity
    }

    toArray(): T[] {
        return [...this.items]
    }
}
