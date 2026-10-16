import { type IOptions, type IOptionsInput, optionArgsSchema } from "@alto/cli"
import { fromZodError } from "zod-validation-error"

type CamelCase<S extends string> =
    S extends `${infer P1}-${infer P2}${infer P3}`
        ? `${P1}${Uppercase<P2>}${CamelCase<P3>}`
        : S extends `${infer P1}_${infer P2}${infer P3}`
          ? `${P1}${Uppercase<P2>}${CamelCase<P3>}`
          : S

export type CamelCasedProperties<T> = {
    [K in keyof T as CamelCase<Extract<K, string>>]: T[K]
}

function toCamelCase(str: string): string {
    return str.replace(/([-_][a-z0-9])/g, (group) =>
        group.toUpperCase().replace("-", "").replace("_", "")
    )
}

function convertKeysToCamelCase<T extends IOptions>(
    obj: T
): CamelCasedProperties<T> {
    return Object.keys(obj).reduce(
        (acc, key) => {
            const camelCaseKey = toCamelCase(
                key
            ) as keyof CamelCasedProperties<T>
            ;(acc as any)[camelCaseKey] = obj[key as keyof T]

            return acc
        },
        {} as CamelCasedProperties<T>
    )
}

export const parseArgs = (
    args: IOptionsInput
): CamelCasedProperties<IOptions> => {
    const parsing = optionArgsSchema.safeParse(args)
    if (!parsing.success) {
        const error = fromZodError(parsing.error)
        throw new Error(error.message)
    }

    return convertKeysToCamelCase(parsing.data)
}
