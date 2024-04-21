import csv from 'csvtojson'
import { dbCompanies } from '../../src/cdp/couchdb'

export default async function importCDPAccessCodes(
    csvFilePath = process.env.CSV_FILE_PATH,
    couchDBUrl = process.env.CouchDB_URL,
) {
    if (!csvFilePath || !couchDBUrl) throw new Error('Missing environment variable(s)')

    let csvEntries = await csv().fromFile(csvFilePath)
    csvEntries = csvEntries
        .map(x => ({
            accountCategory: x.account_category?.trim?.(),
            registrationNumber: x.companynumber?.trim?.(),
        }))
        .filter(x => !!x.registrationNumber && !!x.accountCategory)
    if (!csvEntries.length) return console.log('Empty file')

    const regNum404 = new Map()
    const failed = new Map()
    const skipped = new Map()
    for (let i = 0;i < csvEntries.length;i++) {
        const {
            accountCategory,
            registrationNumber,
        } = csvEntries[i]
        const company = await dbCompanies.find({ registrationNumber })
        if (!company) {
            console.log(i, registrationNumber, ': company not found')
            regNum404.set(registrationNumber, 0)
            continue
        }

        if (!!company?.accounts?.accountCategory) {
            console.log(i, registrationNumber, ': skipping to prevent accountCategory override')
            skipped.set(registrationNumber, 1)
            continue
        }

        await dbCompanies
            .set(company._id, {
                ...company,
                accounts: {
                    accountCategory,
                    ...company.accounts,
                },
            })
            .then(
                () => console.log(i, registrationNumber, ': saved'),
                err => {
                    console.log(i, registrationNumber, ': failed to save', err)
                    failed.set(registrationNumber, err)
                }
            )
    }

    const successCount = csvEntries.length - regNum404.size - failed.size - skipped.size
    console.log({
        failed,
        regNum404: regNum404.size,
        skipped: skipped.size,
        total: csvEntries.length,
        successCount,
        completed: csvEntries.length === successCount,
    })
    if (!regNum404.size) return

    console.log('regNum404:', regNum404.size)
    console.log(JSON.stringify([...regNum404.keys()]))
}


/*
const notFoundArr = ["00599512", "00957939", "00979661", "07254686", "NI668546", "FC037433", "13519889", "OC436985", "12591006", "FC037739", "12516656", "FC039860", "12371282", "13850199", "13845069", "NI680315", "FC038150", "FC037601", "04989520", "NI670589", "14385439", "14404358", "13767244", "NI667308", "OC432287", "12590036", "FC037132", "FC038089", "12325259", "FC040033", "12478853", "SC658572", "FC037509", "FC039023", "02474897", "NI667677", "NI676022", "12692955", "FC036995", "13368499", "FC039801", "14018859", "14016996", "FC040486", "FC037294", "13745313", "NI679872", "13285917", "13257483", "13558213", "13698536", "12461919", "13229544", "00053712", "FC037078", "NI665864", "09768387", "NI666152", "12990954", "FC039114", "14127257", "12323604", "FC038874", "OC431829", "NI689803", "FC038282", "FC038709", "12355145", "NI689761", "12513051", "12358924", "FC038553", "13211979", "FC038886", "13474363", "12810803", "13135553", "12939579", "13813471", "13062564", "NI669300", "NI683057", "OC431301", "FC039303", "FC039788", "13891957", "13641088", "FC038712", "01162966", "13142524", "12405403", "13290343", "FC037548", "12548936", "FC039824", "FC038538", "FC037274", "FC037444", "FC037447", "FC038787", "NI672075", "13564409", "FC037584", "12941186", "00035377", "NI677024", "SC432375", "SC358360", "14177081", "14176279", "FC038669", "SC745815", "NI684576", "SC727393", "11111323", "FC038555", "13572428", "13572408", "13572366", "FC037074", "12844527", "NI674617", "12962492", "FC038602", "FC038827", "NI680811", "NI681689", "00780521", "FC037115", "FC038528", "FC038011", "12352498", "13077631", "FC039099", "FC038794", "FC039878", "12414592", "12314899", "05496202", "FC037358", "14047839", "14048049", "12991943", "NI675652", "01847627", "12383478", "00787736", "12475099", "NI684429", "SC646388", "FC039155", "FC038575", "FC039231", "12383237", "OC431004", "13346124", "FC038111", "00525066", "NI678277", "NI687412", "FC037740", "FC037741", "FC039543", "NI666382", "12407830", "02078453", "FC038412", "00212649", "NI679924", "12484641", "NI688898", "NI667472", "12943236", "FC037129", "FC039148", "13062884", "NI679533", "FC037809", "13813329", "NI669863", "13595200", "06784160", "13219816", "13636745", "OC434822", "FC038572", "FC039344", "13287342", "NI668659", "FC038809", "12515168", "NI682631", "13296183", "FC037212", "12801181", "13559895", "FC040013", "FC038581", "13341013", "12395093", "12414416", "FC038985", "13884886", "05823633", "10386878", "13735391", "12874386", "NI686899", "NI683039", "FC037728", "SC656200", "NI675935", "12920804", "13214639", "13210732", "13213942", "13207768", "13556131", "13723128", "04189339", "13997272", "FC037378", "NI676899", "13244512", "14355610", "12352179", "13177464", "13173774", "NI685232", "NI675553", "13587144", "13807147", "00831084", "FC038851", "FC038924", "13695322", "13179690", "FC039293", "FC039295", "SC701230", "02546223", "00469969", "NI681723", "NI673203", "12691139", "13931732", "12623552", "12524914", "FC038474", "FC038489", "FC038281", "01113881", "13063156", "FC038187", "00283695", "03988507", "13729878", "NI669775", "01099217", "FC038938", "13653225", "FC037327", "FC038644", "03367115", "NI668323", "13791334", "12691027", "12519538", "12444455", "13755206", "13237256", "NI667506", "01139647", "13416878", "SC647028", "12878826", "13856227", "FC036927", "13788564", "FC038906", "NI670089", "12450468", "NI672651", "SC057989", "NI666153", "FC038845", "12496215", "02075280", "12631780", "FC040003", "FC039377", "13732533", "13344064", "12708049", "12503149", "FC039678", "FC037026", "NI671469", "13191371", "13497491", "13415632", "FC040286"]
*/