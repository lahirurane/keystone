import { type BaseItem, type KeystoneContext } from '@keystone-6/core/types'
import { graphql } from '@keystone-6/core'
import { assertInputObjectType, GraphQLInputObjectType, type GraphQLSchema } from 'graphql'

import type { AuthGqlNames, InitFirstItemConfig } from '../types'

export function getInitFirstItemSchema ({
  listKey,
  fields,
  itemData,
  gqlNames,
  graphQLSchema,
  ItemAuthenticationWithPasswordSuccess,
}: {
  listKey: string
  fields: InitFirstItemConfig<any>['fields']
  itemData: InitFirstItemConfig<any>['itemData']
  gqlNames: AuthGqlNames
  graphQLSchema: GraphQLSchema
  ItemAuthenticationWithPasswordSuccess: graphql.ObjectType<{
    item: BaseItem
    sessionToken: string
  }>
  // TODO: return type required by pnpm :(
}): graphql.Extension {
  const createInputConfig = assertInputObjectType(
    graphQLSchema.getType(`${listKey}CreateInput`)
  ).toConfig()
  const fieldsSet = new Set(fields)
  const initialCreateInput = graphql.wrap.inputObject(
    new GraphQLInputObjectType({
      ...createInputConfig,
      fields: Object.fromEntries(
        Object.entries(createInputConfig.fields).filter(([fieldKey]) => fieldsSet.has(fieldKey))
      ),
      name: gqlNames.CreateInitialInput,
    })
  )

  return {
    mutation: {
      [gqlNames.createInitialItem]: graphql.field({
        type: graphql.nonNull(ItemAuthenticationWithPasswordSuccess),
        args: { data: graphql.arg({ type: graphql.nonNull(initialCreateInput) }) },
        async resolve (rootVal, { data }, context: KeystoneContext) {
          if (!context.sessionStrategy) {
            throw new Error('No session implementation available on context')
          }

          const dbItemAPI = context.sudo().db[listKey]

          // should approximate hasInitFirstItemConditions
          const count = await dbItemAPI.count({})
          if (count !== 0) {
            throw new Error('Initial items can only be created when no items exist in that list')
          }

          // Update system state
          // this is strictly speaking incorrect. the db API will do GraphQL coercion on a value which has already been coerced
          // (this is also mostly fine, the chance that people are using things where
          // the input value can't round-trip like the Upload scalar here is quite low)
          const item = await dbItemAPI.createOne({ data: { ...data, ...itemData } })
          const sessionToken = (await context.sessionStrategy.start({
            data: { listKey, itemId: item.id.toString() },
            context,
          }))

          // return Failure if sessionStrategy.start() is incompatible
          if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
            throw new Error('Failed to start session')
          }

          return { item, sessionToken }
        },
      }),
    },
  }
}
