const entityNames = [
  {
    base: 'Alice Johnson',
    variations: [
      'A. Johnson', 'A.J.', 'Alice J.', 'A Johnson', 'Alice J',
      'ALICE JOHNSON', 'johnson alice', 'A. J.', 'alice.johnson',
      'AJohnson', 'Alice-Johnson', 'A_Johnson', 'AliceJ', 'alice j', 'Johnson A'
    ]
  },
  {
    base: 'Nana Li',
    variations: [
      'N. Li', 'Nana L.', 'N Li', 'NANA LI', 'Li Nana',
      'NanaLi', 'nana.li', 'N.L.', 'Li, Nana', 'Nana-Li',
      'nana_li', 'LiNana', 'Li N', 'n.li', 'NANA L'
    ]
  },
  {
    base: 'John Smith',
    variations: [
      'J. Smith', 'J.S.', 'JohnSmith', 'JOHN SMITH', 'Smith John',
      'john.smith', 'J Smith', 'John-Smith', 'john_smith', 'SmithJ',
      'Smith J', 'j.smith', 'JOHN S', 'Johnny Smith', 'Jon Smith'
    ]
  }
]

const rawRecords = []
let recordId = 1

entityNames.forEach((entity, entityIdx) => {
  rawRecords.push({
    id: `r${recordId++}`,
    name: entity.base,
    phone: `1${38 + entityIdx}X-XXX-${1000 + entityIdx}`,
    email: `${entity.base.toLowerCase().replace(' ', '.')}@email.com`,
    entity: entityIdx + 1
  })
  entity.variations.forEach(v => {
    rawRecords.push({
      id: `r${recordId++}`,
      name: v,
      phone: Math.random() > 0.3 ? `1${38 + entityIdx}X-XXX-${1000 + entityIdx}` : 'none',
      email: Math.random() > 0.3 ? `${entity.base.toLowerCase().replace(' ', '.')}@email.com` : 'none',
      entity: entityIdx + 1
    })
  })
})

export { rawRecords, entityNames }
