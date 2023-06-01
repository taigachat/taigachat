// TODO: idempotence should be rethought

let nextIdempotence = 0
const informLists: Map<string, any> = new Map()

export function createInform(userID: string, type: string, inform: any) {
    // TODO: We should probably check if userID has even joined the server.
    // TODO: Maybe we should also have a limit on how many unseen informs a user can have

    inform.idempotence = ++nextIdempotence
    inform.type = type
    inform.timestamp = Date.now()
    const list = informLists.get(userID)
    if (list !== undefined) {
        while (list.length > 128) {
            list.shift()
        }
        list.push(inform)
    } else {
        const informList = [inform]
        informLists.set(userID, informList)
    }
}

export function getNextInform(userID: string, idempotence: number) {
    const informList = informLists.get(userID)
    if (informList) {
        if (informList.length > 0) {
            if (informList[0].idempotence == idempotence) {
                informList.shift()
                if (informList.length > 0) {
                    return informList[0]
                } else {
                    return null
                }
            } else {
                return informList[0]
            }
        } else {
            return null
        }
    } else {
        return null
    }
}
