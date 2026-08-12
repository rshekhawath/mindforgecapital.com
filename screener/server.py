"""
MFC Screener — Local Flask Backend
Full NSE EQ-series universe: 2123 stocks (source: NSE EQUITY_L.csv, June 2026)
Data model: 65+ fundamental & derived fields per stock.
"""

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
import yfinance as yf
import sqlite3, json, os, math, time
from datetime import datetime, timedelta

app = Flask(__name__)
CORS(app)

_BASE_DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "screener.db")
# Use tmp fallback only if primary path is unwritable
import tempfile as _tf
def _resolve_db_path():
    try:
        _d = os.path.dirname(_BASE_DB_PATH)
        os.makedirs(_d, exist_ok=True)
        _t = _BASE_DB_PATH + ".probe"
        open(_t, "a").close(); os.remove(_t)
        return _BASE_DB_PATH
    except Exception:
        return os.path.join(_tf.gettempdir(), "mfc_screener.db")
DB_PATH = _resolve_db_path()

# ──────────────────────────────────────────────────────────────────────────────
# Full NSE EQ-series universe (2123 stocks)
# Yahoo Finance supports SYMBOL.NS for every entry.
# The screener fetches data on-demand and caches for 1 hour.
# ──────────────────────────────────────────────────────────────────────────────
NSE_EQUITY_UNIVERSE = [
    "20MICRONS","21STCENMGM","360ONE","3BBLACKBIO","3IINFOLTD","3MINDIA","3PLAND","5PAISA","63MOONS","A2ZINFRA",
    "AAATECH","AADHARHFC","AARNAV","AARON","AARTECH","AARTIDRUGS","AARTIIND","AARTIPHARM","AARTISURF","AARVI",
    "AAVAS","ABB","ABBOTINDIA","ABCAPITAL","ABCOTS","ABDL","ABFRL","ABINFRA","ABLBL","ABMINTLLTD",
    "ABMKNO","ABREL","ABSLAMC","ACC","ACCELYA","ACCURACY","ACE","ACEINTEG","ACI","ACL",
    "ACMESOLAR","ACSTECH","ACUTAAS","ADANIENSOL","ADANIENT","ADANIGREEN","ADANIPORTS","ADANIPOWER","ADFFOODS","ADL",
    "ADOR","ADROITINFO","ADSL","ADVAIT","ADVANCE","ADVANIHOTR","ADVENTHTL","ADVENZYMES","AEGISLOG","AEGISVOPAK",
    "AEPL","AEQUS","AEROENTER","AEROFLEX","AERONEU","AETHER","AFCONS","AFFLE","AFSL","AGARIND",
    "AGARWALEYE","AGI","AGIIL","AGRITECH","AGROPHOS","AHCL","AHLADA","AHLEAST","AHLUCONT","AIAENG",
    "AIIL","AIRAN","AIROLAM","AJANTPHARM","AJAXENGG","AJMERA","AJOONI","AKASH","AKCAPIT","AKG",
    "AKI","AKSHAR","AKSHARCHEM","AKUMS","ALANKIT","ALBERTDAVD","ALEMBICLTD","ALGOQUANT","ALICON","ALIVUS",
    "ALKEM","ALKYLAMINE","ALLCARGO","ALLDIGI","ALLTIME","ALMONDZ","ALOKINDS","ALPA","ALPHAGEO","AMAGI",
    "AMANTA","AMBALALSA","AMBER","AMBICAAGAR","AMBIKCO","AMBUJACEM","AMDIND","AMIRCHAND","AMJLAND","AMNPLST",
    "AMRUTANJAN","ANANDRATHI","ANANTRAJ","ANDHRAPAP","ANDHRSUGAR","ANGELONE","ANMOL","ANTELOPUS","ANTGRAPHIC","ANTHEM",
    "ANUHPHR","ANUP","ANURAS","APARINDS","APCL","APCOTEXIND","APEX","APLAPOLLO","APLLTD","APOLLO",
    "APOLLOHOSP","APOLLOPIPE","APOLLOTYRE","APOLSINHOT","APTECHT","APTUS","AQYLON","ARCHIDPLY","ARCHIES","ARE&M",
    "ARENTERP","ARFIN","ARIES","ARIHANT","ARIHANTCAP","ARIHANTSUP","ARIS","ARKADE","ARMANFIN","AROGRANITE",
    "ARROWGREEN","ARSSBL","ARTEMISMED","ARTNIRMAN","ARVEE","ARVIND","ARVINDFASN","ARVSMART","ASAHIINDIA","ASAHISONG",
    "ASAL","ASALCBR","ASHAPURMIN","ASHIANA","ASHIKA","ASHIMASYN","ASHOKA","ASHOKAMET","ASHOKLEY","ASIANENE",
    "ASIANHOTNR","ASIANPAINT","ASIANTILES","ASKAUTOLTD","ASMS","ASPINWALL","ASTAR","ASTEC","ASTERDM","ASTRAL",
    "ASTRAMICRO","ASTRAZEN","ATALREAL","ATAM","ATGL","ATHERENERG","ATL","ATLANTAA","ATLASCYCLE","ATUL",
    "ATULAUTO","AUBANK","AURIGROW","AURIONPRO","AUROPHARMA","AURUM","AUTOAXLES","AVALON","AVANTEL","AVANTIFEED",
    "AVG","AVL","AVONMORE","AVROIND","AVTNPL","AWFIS","AWHCL","AWL","AXISBANK","AXISCADES",
    "AXITA","AYE","AYMSYNTEX","AZAD","BAFNAPH","BAGFILMS","BAIDFIN","BAJAJ-AUTO","BAJAJCON","BAJAJELEC",
    "BAJAJFINSV","BAJAJHCARE","BAJAJHFL","BAJAJHIND","BAJAJHLDNG","BAJAJINDEF","BAJAJST","BAJEL","BAJFINANCE","BALAJEE",
    "BALAJITELE","BALAMINES","BALKRISHNA","BALKRISIND","BALMLAWRIE","BALPHARMA","BALRAMCHIN","BALUFORGE","BANARBEADS","BANARISUG",
    "BANCOINDIA","BANDHANBNK","BANG","BANKBARODA","BANKINDIA","BANSALWIRE","BANSWRAS","BASF","BASML","BATAINDIA",
    "BATLIBOI","BAYERCROP","BBL","BBOX","BBTC","BBTCL","BCG","BCLIND","BCONCEPTS","BCPL",
    "BDL","BEARDSELL","BECTORFOOD","BEDMUTHA","BEEKAY","BEL","BELLACASA","BELRISE","BEML","BENGALASM",
    "BEPL","BERGEPAINT","BESTAGRO","BETA","BFINVEST","BFUTILITIE","BHAGCHEM","BHAGERIA","BHARATCOAL","BHARATFORG",
    "BHARATGEAR","BHARATRAS","BHARATSE","BHARATWIRE","BHARTIARTL","BHARTIHEXA","BHEL","BI","BIGBLOC","BIKAJI",
    "BIL","BIMETAL","BIOCON","BIOFILCHEM","BIRLACORPN","BIRLAMONEY","BIRLANU","BIRLAPREC","BLACKBUCK","BLACKROSE",
    "BLAL","BLBLIMITED","BLIL","BLISSGVS","BLKASHYAP","BLS","BLSE","BLUECHIP","BLUEDART","BLUEJET",
    "BLUESTARCO","BLUESTONE","BLUSPRING","BMWVENTLTD","BNALTD","BOMDYEING","BONLON","BORANA","BOROLTD","BORORENEW",
    "BOROSCI","BOSCH-HCIL","BOSCHLTD","BPCL","BPL","BRIGADE","BRIGHOTEL","BRITANNIA","BRNL","BSE",
    "BSL","BSOFT","BTML","BTTL","BUILDPRO","BUTTERFLY","BVCL","BYKE","CAMLINFINE","CAMPUS",
    "CAMS","CANBK","CANFINHOME","CANHLIFE","CANTABIL","CAPACITE","CAPILLARY","CAPITALSFB","CAPLIPOINT","CARBORUNIV",
    "CARERATING","CARRARO","CARTRADE","CARYSIL","CASTROLIND","CCAVENUE","CCCL","CCHHL","CCL","CDSL",
    "CEATLTD","CEIGALL","CEINSYS","CELEBRITY","CELLO","CEMPRO","CENTENKA","CENTEXT","CENTRALBK","CENTRUM",
    "CENTUM","CENTURYPLY","CERA","CESC","CEWATER","CGCL","CGPOWER","CHALET","CHAMBLFERT","CHEMCON",
    "CHEMPLASTS","CHENNPETRO","CHEVIOT","CHOICEIN","CHOLAFIN","CHOLAHLDNG","CIEINDIA","CIFL","CINELINE","CINEVISTA",
    "CIPLA","CLEAN","CLEANMAX","CLSEL","CMPDI","CMSINFO","CNL","COALINDIA","COASTCORP","COCHINSHIP",
    "COCKERILL","COFORGE","COHANCE","COLPAL","COMFINTE","COMPUSOFT","COMSYN","CONCOR","CONCORDBIO","CONFIPET",
    "CONSOFINVT","CONTROLPR","CORALFINAC","COROMANDEL","CORONA","COSMOFIRST","COUNCODOS","CPEDU","CPPLUS","CRAFTSMAN",
    "CRAMC","CREATIVEYE","CREDITACC","CREST","CRISIL","CRIZAC","CROMPTON","CROWN","CSBBANK","CSLFINANCE",
    "CTE","CUB","CUBEXTUB","CUMMINSIND","CUPID","CYBERTECH","CYIENT","CYIENTDLM","DABUR","DAICHI",
    "DALBHARAT","DALMIASUG","DAMCAPITAL","DAMODARIND","DANGEE","DATAMATICS","DATAPATTNS","DAVANGERE","DBCORP","DBL",
    "DBSTOCKBRO","DCAL","DCBBANK","DCM","DCMSHRIRAM","DCMSRIND","DCW","DCXINDIA","DDEVPLSTIK","DECCANCE",
    "DECNGOLD","DEEPAKFERT","DEEPAKNTR","DEEPINDS","DELHIVERY","DELPHIFX","DELTACORP","DELTAMAGNT","DEN","DENORA",
    "DENTA","DEVIT","DEVX","DEVYANI","DGCONTENT","DHAMPURSUG","DHANBANK","DHANUKA","DHARMAJ","DHUNINV",
    "DIACABS","DIAMINESQ","DIAMONDYD","DICIND","DIFFNKG","DIGIDRIVE","DIGITIDE","DIGJAMLMTD","DISAQ","DIVGIITTS",
    "DIVISLAB","DIXON","DJML","DLF","DLINKINDIA","DMART","DMCC","DNAMEDIA","DODLA","DOLATALGO",
    "DOLLAR","DOLPHIN","DOMS","DONEAR","DPABHUSHAN","DPWIRES","DRAGARWQ","DRCSYSTEMS","DREAMFOLKS","DREDGECORP",
    "DRREDDY","DSFCL","DSSL","DTIL","DVL","DWARKESH","DYCL","DYNAMATECH","DYNPRO","E2E",
    "EASEMYTRIP","EBGNG","ECLERX","EDELWEISS","EFCIL","EICHERMOT","EIDPARRY","EIEL","EIFFL","EIHAHOTELS",
    "EIHOTEL","EIMCOELECO","EKC","ELANTAS","ELCIDIN","ELDEHSG","ELECON","ELECTCAST","ELECTHERM","ELGIEQUIP",
    "ELGIRUBCO","ELIN","ELITECON","ELLEN","ELPROINTL","EMAMILTD","EMAMIPAP","EMBDL","EMCURE","EMIL",
    "EMKAY","EMMBI","EMMVEE","EMSLIMITED","EMUDHRA","ENDURANCE","ENERGYDEV","ENGINERSIN","ENIL","ENRIN",
    "ENTERO","EPACK","EPACKPEB","EPIGRAL","EPL","EQUITASBNK","ERIS","ESABINDIA","ESAFSFB","ESCORTS",
    "ESSARSHPNG","ESTER","ETERNAL","ETHOSLTD","EUREKAFORB","EUROBOND","EUROPRATIK","EUROTEXIND","EVEREADY","EVERESTIND",
    "EXCELINDUS","EXCELSOFT","EXICOM","EXIDEIND","EXPLEOSOL","EXXARO","FABTECH","FACT","FAIRCHEMOR","FAZE3Q",
    "FCL","FDC","FEDDERSHOL","FEDERALBNK","FEDFINA","FERMENTA","FIBERWEB","FIEMIND","FILATEX","FINCABLES",
    "FINEORG","FINKURVE","FINOPB","FINPIPE","FIRSTCRY","FISCHER","FIVESTAR","FLAIR","FLEXITUFF","FLUOROCHEM",
    "FMGOETZE","FOCUS","FOODSIN","FORCEMOT","FORTIS","FOSECOIND","FRACTAL","FRONTSP","FSL","FUSION",
    "GABRIEL","GAEL","GAIL","GALAPREC","GALAXYSURF","GALLANTT","GANDHAR","GANDHITUBE","GANECOS","GANESHBE",
    "GANESHCP","GANESHHOU","GANGAFORGE","GANGESSECU","GARFIBRES","GARUDA","GATECH","GATECHDVR","GATEWAY","GAYAHWS",
    "GCSL","GEECEE","GEEKAYWIRE","GENCON","GENESYS","GENUSPAPER","GENUSPOWER","GEOJITFSL","GESHIP","GFLLIMITED",
    "GHCL","GHCLTEXTIL","GICHSGFIN","GICL","GICRE","GILLANDERS","GILLETTE","GINNIFILA","GIPCL","GKENERGY",
    "GKSL","GKWLIMITED","GLAND","GLAXO","GLENMARK","GLOBAL","GLOBALVECT","GLOBE","GLOBUSSPR","GLOSTERLTD",
    "GMBREW","GMDCLTD","GMMPFAUDLR","GMRAIRPORT","GMRP&UI","GNA","GNFC","GNRL","GOACARBON","GOCLCORP",
    "GOCOLORS","GODAVARIB","GODFRYPHLP","GODIGIT","GODREJAGRO","GODREJCP","GODREJIND","GODREJPROP","GOKEX","GOKUL",
    "GOKULAGRO","GOLDIAM","GOLDTECH","GOODLUCK","GOODYEAR","GOPAL","GOYALALUM","GPIL","GPPL","GPTHEALTH",
    "GPTINFRA","GRADIENTE","GRANDOAK","GRANULES","GRAPHITE","GRASIM","GRAUWEIL","GRAVISSHO","GRAVITA","GREAVESCOT",
    "GREENLAM","GREENPANEL","GREENPLY","GREENPOWER","GRINDWELL","GRINFRA","GRMOVER","GROBTEA","GROWW","GRPLTD",
    "GRSE","GRWRHITECH","GSFC","GSLSU","GSPCROP","GTECJAINX","GTL","GTLINFRA","GTPL","GUFICBIO",
    "GUJALKALI","GUJAPOLLO","GUJGASLTD","GUJRAFFIA","GUJTHEM","GULFOILLUB","GULFPETRO","GULPOLY","GVPIL","GVPTECH",
    "GVT&D","HAL","HALDER","HALDYNGL","HALEOSLABS","HAPPSTMNDS","HAPPYFORGE","HARDWYN","HARIOMPIPE","HARRMALAYA",
    "HARSHA","HATHWAY","HATSUN","HAVELLS","HAVISHA","HAWKINCOOK","HBESD","HBLENGINE","HCC","HCG",
    "HCL-INSYS","HCLTECH","HDBFS","HDFCAMC","HDFCBANK","HDFCLIFE","HEADSUP","HEALTHX","HECPROJECT","HEG",
    "HEIDELBERG","HEMIPROP","HERANBA","HERITGFOOD","HEROMOTOCO","HESTERBIO","HEXATRADEX","HEXT","HFCL","HGINFRA",
    "HGM","HGS","HIKAL","HIMATSEIDE","HINDALCO","HINDCOMPOS","HINDCOPPER","HINDOILEXP","HINDPETRO","HINDUNILVR",
    "HINDWAREAP","HINDZINC","HIRECT","HISARMETAL","HITECH","HLEGLAS","HLVLTD","HMAAGRO","HMVL","HNDFDS",
    "HOMEFIRST","HONASA","HONAUT","HONDAPOWER","HPAL","HPIL","HPL","HSCL","HTMEDIA","HUBTOWN",
    "HUDCO","HUHTAMAKI","HYBRIDFIN","HYUNDAI","ICDSLTD","ICEMAKE","ICICIAMC","ICICIBANK","ICICIGI","ICICIPRULI",
    "ICIL","ICRA","IDBI","IDEA","IDFCFIRSTB","IEX","IFBIND","IFCI","IFGLEXPOR","IGARASHI",
    "IGCL","IGIL","IGL","IGPL","IIFL","IIFLCAPS","IITL","IKIO","IKS","IMAGICAA",
    "IMFA","IMPAL","INA","INCREDIBLE","INDBANK","INDGN","INDHOTEL","INDIACEM","INDIAGLYCO","INDIAMART",
    "INDIANB","INDIANCARD","INDIANHUME","INDIASHLTR","INDIGO","INDIGOPNTS","INDIQUBE","INDNIPPON","INDOAMIN","INDOBORAX",
    "INDOCO","INDOFARM","INDORAMA","INDOSTAR","INDOTHAI","INDOUS","INDPRUD","INDRAMEDCO","INDSWFTLAB","INDTERRAIN",
    "INDUSINDBK","INDUSTOWER","INFOBEAN","INFOMEDIA","INFY","INGERRAND","INNOVACAP","INNOVANA","INNOVISION","INOXGREEN",
    "INOXINDIA","INOXWIND","INSECTICID","INTELLECT","INTENTECH","INTERARCH","INTLCONV","INVENTURE","INVPRECQ","IOB",
    "IOC","IOLCP","IONEXCHANG","IPCALAB","IPL","IRB","IRCON","IRCTC","IREDA","IRFC",
    "IRIS","IRISDOREME","IRMENERGY","ISFT","ISGEC","ISHANCH","ITC","ITCHOTELS","ITDC","ITI",
    "IVALUE","IVC","IVP","IWP","IXIGO","IZMO","J&KBANK","JAGRAN","JAGSNPHARM","JAICORPLTD",
    "JAINREC","JAIPURKURT","JAMNAAUTO","JARO","JASH","JAYAGROGN","JAYBARMARU","JAYKAY","JAYNECOIND","JAYSREETEA",
    "JBCHEPHARM","JBMA","JETFREIGHT","JGCHEM","JHS","JINDALPHOT","JINDALPOLY","JINDALSAW","JINDALSTEL","JINDRILL",
    "JINDWORLD","JIOFIN","JISLDVREQS","JISLJALEQS","JITFINFRA","JKCEMENT","JKIL","JKLAKSHMI","JKPAPER","JKTYRE",
    "JLHL","JMA","JMFINANCIL","JNKINDIA","JPOLYINVST","JPPOWER","JSFB","JSL","JSLL","JSWCEMENT",
    "JSWDULUX","JSWENERGY","JSWHL","JSWINFRA","JSWSTEEL","JTEKTINDIA","JTLIND","JUBLCPL","JUBLFOOD","JUBLINGREA",
    "JUBLPHARMA","JUNIPER","JUSTDIAL","JWL","JYOTHYLAB","JYOTICNC","JYOTISTRUC","KABRAEXTRU","KAJARIACER","KALAMANDIR",
    "KALPATARU","KALYANIFRG","KALYANKJIL","KAMAHOLD","KAMATHOTEL","KAMDHENU","KAMOPAINTS","KANANIIND","KANPRPLA","KANSAINER",
    "KAPSTON","KARMAENG","KARURVYSYA","KAUSHALYA","KAVDEFENCE","KAYA","KAYNES","KCP","KCPSUGIND","KDDL",
    "KEC","KEEPLEARN","KEI","KELLTONTEC","KENNAMET","KERNEX","KEYFINSERV","KFINTECH","KHADIM","KHANDSE",
    "KICL","KILITCH","KIMS","KINGFA","KIOCL","KIRANVYPAR","KIRIINDUS","KIRLFER","KIRLOSBROS","KIRLOSENG",
    "KIRLOSIND","KIRLPNU","KISSHT","KITEX","KKCL","KLBRENG-B","KMEW","KMSUGAR","KNAGRI","KNRCON",
    "KOHINOOR","KOKUYOCMLN","KOLTEPATIL","KOTAKBANK","KOTARISUG","KOTHARIPET","KOTHARIPRO","KOTIC","KOTYARK","KOVAI",
    "KPEL","KPIGREEN","KPIL","KPITTECH","KPL","KPRMILL","KRBL","KREBSBIO","KRISHANA","KRISHIVAL",
    "KRISHNADEF","KRITIKA","KRONOX","KROSS","KRSNAA","KRYSTAL","KSB","KSCL","KSHINTL","KSL",
    "KSOLVES","KTKBANK","KUANTUM","KWIL","LAGNAM","LAHOTIOV","LAL","LALPATHLAB","LAMBODHARA","LANCORHOL",
    "LANDMARK","LANDSMILL","LAOPALA","LASA","LATENTVIEW","LAURUSLABS","LAXMICOT","LAXMIDENTL","LEMERITE","LEMONTREE",
    "LENSKART","LEXUS","LFIC","LGBBROSLTD","LGEINDIA","LGHL","LIBAS","LIBERTSHOE","LICHSGFIN","LICI",
    "LINC","LINCOLN","LINDEINDIA","LLOYDSENGG","LLOYDSENT","LLOYDSME","LMW","LODHA","LORDSCHLO","LOTUSDEV",
    "LOTUSEYE","LOVABLE","LPDC","LT","LTF","LTFOODS","LTM","LTTS","LUMAXIND","LUMAXTECH",
    "LUPIN","LUXIND","LXCHEM","LYKALABS","LYPSAGEMS","M&M","M&MFIN","MAANALU","MACPOWER","MADHAV",
    "MADHAVIPL","MADHUCON","MADRASFERT","MAFATIND","MAGADSUGAR","MAGNUM","MAHABANK","MAHAPEXLTD","MAHEPC","MAHESHWARI",
    "MAHLIFE","MAHLOG","MAHSCOOTER","MAHSEAMLES","MAITHANALL","MAJESAUT","MALLCOM","MALUPAPER","MAMATA","MANAKALUCO",
    "MANAKCOAT","MANAKSIA","MANALIPETC","MANAPPURAM","MANBA","MANCREDIT","MANGLMCEM","MANINDS","MANINFRA","MANKIND",
    "MANOMAY","MANORAMA","MANUGRAPH","MANYAVAR","MAPMYINDIA","MARATHON","MARICO","MARINE","MARKOLINES","MARKSANS",
    "MARSONS","MARUTI","MASFIN","MASTEK","MASTERTR","MATRIMONY","MAXESTATES","MAXHEALTH","MAXIND","MAYURUNIQ",
    "MAZDA","MAZDOCK","MBAPL","MBEL","MBLINFRA","MCCHRLS-B","MCL","MCLOUD","MCX","MEDANTA",
    "MEDIASSIST","MEDICAMEQ","MEDICO","MEDPLUS","MEESHO","MEGASTAR","MENNPIS","MENONBE","MERCANTILE","METROBRAND",
    "METROGLOBL","METROPOLIS","MFML","MFSL","MGL","MHLXMIRU","MHRIL","MICEL","MIDHANI","MIDWESTLTD",
    "MINDACORP","MINDTECK","MIRZAINT","MITTAL","MKPL","MMFL","MMP","MMTC","MOBIKWIK","MODIRUBBER",
    "MODIS","MODTHREAD","MOHITIND","MOIL","MOKSH","MOL","MOLDTECH","MOLDTKPAC","MONARCH","MONEYBOXX",
    "MONTECARLO","MOREPENLAB","MOSCHIP","MOTHERSON","MOTILALOFS","MOTISONS","MPHASIS","MPSLTD","MRF","MRPL",
    "MSPL","MSTCLTD","MSUMI","MTARTECH","MTNL","MUFIN","MUFTI","MUKANDLTD","MUKKA","MUKTAARTS",
    "MUNJALAU","MUNJALSHOW","MURUDCERA","MUTHOOTCAP","MUTHOOTFIN","MUTHOOTMF","MVGJL","MWL","NACLIND","NAGREEKEXP",
    "NAHARCAP","NAHARINDUS","NAHARPOLY","NAM-INDIA","NARMADA","NATCAPSUQ","NATCOPHARM","NATHBIOGEN","NATIONALUM","NATIONSTD",
    "NAUKRI","NAVA","NAVINFLUOR","NAVKARCORP","NAVKARURB","NAVNETEDUL","NAZARA","NBCC","NBIFIN","NCC",
    "NCLIND","NDGL","NDL","NDLVENTURE","NDRAUTO","NDTV","NEAGI","NECCLTD","NELCAST","NELCO",
    "NEOGEN","NEPHROPLUS","NESCO","NESTLEIND","NETWEB","NETWORK18","NEULANDLAB","NEWGEN","NEXTMEDIA","NFL",
    "NGLFINE","NH","NHPC","NIACL","NIBE","NIBL","NIITLTD","NIITMTS","NILAINFRA","NILASPACES",
    "NILE","NILKAMAL","NIPPOBATRY","NIRAJISPAT","NIRLON","NITCO","NITINSPIN","NITIRAJ","NITTAGELA","NIVABUPA",
    "NKIND","NLCINDIA","NMDC","NOCIL","NORBTEAEXP","NORTHARC","NOVAAGRI","NOVARTIND","NPST","NRAIL",
    "NRBBEARING","NRL","NSIL","NSLNISP","NTPC","NTPCGREEN","NUCLEUS","NURECA","NUVAMA","NUVOCO",
    "NYKAA","OAL","OBCL","OBEROIRLTY","OCCLLTD","ODIGMA","OFSS","OIL","OLAELEC","OLECTRA",
    "OMAXE","OMFREIGHT","OMINFRAL","OMNI","OMPOWER","ONEPOINT","ONESOURCE","ONGC","ONMOBILE","ONWARDTEC",
    "OPTIEMUS","ORBTEXP","ORCHASP","ORCHPHARMA","ORICONENT","ORIENTALTL","ORIENTBELL","ORIENTCEM","ORIENTCER","ORIENTELEC",
    "ORIENTHOT","ORIENTLTD","ORIENTPPR","ORIENTTECH","ORISSAMINE","ORKLAINDIA","ORTINGLOBE","OSWALGREEN","OSWALPUMPS","OSWALSEEDS",
    "PACEDIGITK","PAGEIND","PAISALO","PAKKA","PALASHSECU","PANACEABIO","PANACHE","PANAMAPET","PANSARI","PAR",
    "PARACABLES","PARADEEP","PARAGMILK","PARAS","PARASPETRO","PARKHOSPS","PARKHOTELS","PASHUPATI","PASUPTAC","PATANJALI",
    "PATELENG","PATELRMART","PATINTLOG","PAUSHAKLTD","PAYTM","PCBL","PCJEWELLER","PDMJEPAPER","PDSL","PENIND",
    "PERSISTENT","PETRONET","PFC","PFIZER","PFS","PGEL","PGHH","PGHL","PGIL","PHOENIXLTD",
    "PICCADIL","PIDILITIND","PIGL","PIIND","PILANIINVS","PINELABS","PIONEEREMB","PIONRINV","PIRAMALFIN","PITTIENG",
    "PIXTRANS","PKTEA","PLASTIBLEN","PLATIND","PML","PNB","PNBGILTS","PNBHOUSING","PNC","PNCINFRA",
    "PNGJL","PNGSREVA","POCL","PODDARMENT","POKARNA","POLICYBZR","POLYCAB","POLYMED","POLYPLEX","PONNIERODE",
    "POONAWALLA","POWERGRID","POWERICA","POWERINDIA","POWERMECH","PPAP","PPL","PPLPHARMA","PRABHA","PRADPME",
    "PRAENG","PRAJIND","PRAKASH","PRAKASHSTL","PRAVEG","PRECAM","PRECOT","PRECWIRE","PREMCO","PREMEXPLN",
    "PREMIERENE","PRESTIGE","PRICOLLTD","PRIMESECU","PRIMO","PRINCEPIPE","PRITI","PRITIKAUTO","PRIVISCL","PROSTARM",
    "PROTEAN","PROZONER","PRSMJOHNSN","PRUDENT","PRUDMOULI","PSB","PSPPROJECT","PTC","PTCIL","PTL",
    "PUNJABCHEM","PURVA","PVP","PVRINOX","PVSL","PWL","PYRAMID","QUADFUTURE","QUESS","QUINT",
    "RACLGEAR","RADAAN","RADHIKAJWE","RADIANTCMS","RADICO","RADIOCITY","RAILTEL","RAIN","RAINBOW","RAJMET",
    "RAJOOENG","RAJPALAYAM","RAJRATAN","RAJSREESUG","RAJTV","RALLIS","RAMANEWS","RAMAPHO","RAMASTEEL","RAMCOCEM",
    "RAMCOIND","RAMCOSYS","RAMKY","RAMRAT","RANASUG","RANEHOLDIN","RATEGAIN","RATNAMANI","RATNAVEER","RAYMOND",
    "RAYMONDLSL","RAYMONDREL","RBA","RBLBANK","RBZJEWEL","RCF","RECLTD","REDINGTON","REDTAPE","REFEX",
    "REGENCERAM","RELAXO","RELCHEMQ","RELIABLE","RELIANCE","RELIGARE","RELTD","REMSONSIND","RENUKA","REPCOHOME",
    "REPL","REPRO","RESPONIND","RETAIL","RGL","RHETAN","RHIM","RHL","RICOAUTO","RIIL",
    "RISHABH","RITCO","RITES","RKDL","RKEC","RKFORGE","RKSWAMY","RMDRIP","RML","RNBDENIMS",
    "ROHLTD","ROLEXRINGS","ROML","ROSSARI","ROSSELLIND","ROSSTECH","ROTO","ROUTE","RPEL","RPGLIFE",
    "RPOWER","RPPINFRA","RPPL","RPSGVENT","RPTECH","RRIL","RRKABEL","RSDFIN","RSL","RSWM",
    "RSYSTEMS","RTNINDIA","RTNPOWER","RUBFILA","RUBICON","RUCHINFRA","RUCHIRA","RUPA","RUSHIL","RUSTOMJEE",
    "RVHL","RVNL","RVTH","SAATVIKGL","SADBHAV","SADBHIN","SAFARI","SAGARDEEP","SAGCEM","SAGILITY",
    "SAHLIBHFI","SAHYADRI","SAIL","SAILIFE","SAIPARENT","SAKAR","SAKHTISUG","SAKSOFT","SALASAR","SALONA",
    "SALZERELEC","SAMBHAAV","SAMBHV","SAMHI","SAMMAANCAP","SAMPANN","SANATHAN","SANDESH","SANDHAR","SANDUMA",
    "SANGAMIND","SANGHVIMOV","SANOFI","SANOFICONR","SANSERA","SANSTAR","SAPPHIRE","SAPPL","SARDAEN","SAREGAMA",
    "SARLAPOLY","SASKEN","SATIA","SATIN","SAURASHCEM","SAYAJIHOTL","SBC","SBCL","SBFC","SBGLP",
    "SBICARD","SBILIFE","SBIN","SCANSTL","SCHAEFFLER","SCHAND","SCHNEIDER","SCI","SCILAL","SCODATUBES",
    "SDBL","SEAMECLTD","SECMARK","SECURKLOUD","SEDEMAC","SEIL","SELMC","SENCO","SENORES","SEPC",
    "SERVOTECH","SESHAPAPER","SETL","SFL","SGFIN","SGIL","SGL","SGMART","SHADOWFAX","SHAH",
    "SHAHALLOYS","SHAILY","SHAKTIPUMP","SHALBY","SHALPAINTS","SHANTI","SHANTIGEAR","SHANTIGOLD","SHARDACROP","SHARDAMOTR",
    "SHARDUL","SHAREINDIA","SHBAJRG","SHEMAROO","SHILCTECH","SHILPAMED","SHINDL","SHIVATEX","SHIVAUM","SHK",
    "SHOPERSTOP","SHRADHA","SHREDIGCEM","SHREECEM","SHREEJISPG","SHREEPUSHK","SHREERAMA","SHREYANIND","SHRIKRISH","SHRINGARMS",
    "SHRIPISTON","SHRIRAMFIN","SHRIRAMPPS","SHYAMCENT","SHYAMMETL","SICAGEN","SIEMENS","SIGIND","SIGMA","SIGNATURE",
    "SIGNPOST","SIKA","SIKKO","SIL","SILGO","SILINV","SILLYMONKS","SILVERTUC","SIMPLEXINF","SINCLAIR",
    "SINDHUTRAD","SINGERIND","SINTERCOM","SIRCA","SIS","SIYSIL","SJS","SJVN","SKFINDIA","SKFINDUS",
    "SKIPPER","SKMEGGPROD","SKYGOLD","SMARTWORKS","SMCGLOBAL","SMLMAH","SMLT","SMSPHARMA","SNOWMAN","SOBHA",
    "SOLARA","SOLARINDS","SOLARWORLD","SOLEX","SOMANYCERA","SOMATEX","SOMICONVEY","SONACOMS","SONAL","SONAMLTD",
    "SONATSOFTW","SOTL","SOUTHBANK","SOUTHWEST","SPAL","SPANDANA","SPARC","SPCENET","SPECIALITY","SPECTRUM",
    "SPENCERS","SPIC","SPLIL","SPLPETRO","SPMLINFRA","SPORTKING","SRD","SREEL","SRF","SRGHFL",
    "SRHHYPOLTD","SRM","SRTL","SSDL","SSWL","STALLION","STANLEY","STAR","STARCEMENT","STARHEALTH",
    "STARPAPER","STARTECK","STCINDIA","STEELCAS","STEELCITY","STEELXIND","STEL","STERTOOLS","STOVEKRAFT","STUDDS",
    "STYL","STYLAMIND","STYRENIX","SUBROS","SUDARCOLOR","SUDARSCHEM","SUDEEPPHRM","SUKHJITS","SULA","SUMEETINDS",
    "SUMICHEM","SUMMITSEC","SUNCLAY","SUNDARAM","SUNDARMFIN","SUNDRMBRAK","SUNDRMFAST","SUNDROP","SUNFLAG","SUNPHARMA",
    "SUNTECK","SUNTV","SUPERHOUSE","SUPERSPIN","SUPRAJIT","SUPREME","SUPREMEIND","SUPREMEINF","SUPRIYA","SURAJEST",
    "SURAJLTD","SURAKSHA","SURANASOL","SURANAT&P","SURYALA","SURYALAXMI","SURYAROSNI","SURYODAY","SUTLEJTEX","SUVEN",
    "SUVIDHAA","SUYOG","SUZLON","SVLL","SWANCORP","SWARAJENG","SWELECTES","SWIGGY","SWSOLAR","SYMPHONY",
    "SYNCOMF","SYNGENE","SYRMA","SYSTMTXC","TAALTECH","TAINWALCHM","TAJGVK","TALBROAUTO","TAMBOLIIN","TANLA",
    "TARACHAND","TARAPUR","TARC","TARIL","TARMAT","TARSONS","TASTYBITE","TATACAP","TATACHEM","TATACOMM",
    "TATACONSUM","TATAELXSI","TATAINVEST","TATAPOWER","TATASTEEL","TATATECH","TATVA","TBOTEK","TBZ","TCC",
    "TCI","TCIEXP","TCIFINANCE","TCPLPACK","TCS","TDPOWERSYS","TEAMGTY","TEAMLEASE","TECHM","TECHNOE",
    "TECHNVISN","TECILCHEM","TEGA","TEJASNET","TEMBO","TENNIND","TERASOFT","TEXINFRA","TEXMOPIPES","TEXRAIL",
    "TFCILTD","TFL","TGBHOTELS","THAKDEV","THANGAMAYL","THEINVEST","THEJO","THELEELA","THEMISMED","THERMAX",
    "THOMASCOOK","THOMASCOTT","THYROCARE","TI","TICL","TIIL","TIINDIA","TIJARIA","TIL","TIMETECHNO",
    "TIMEX","TIMKEN","TINNARUBR","TIPSFILMS","TIPSMUSIC","TIRUMALCHM","TITAGARH","TITAN","TMB","TMCV",
    "TMPV","TNPETRO","TNPL","TNTELE","TOLINS","TORNTPHARM","TORNTPOWER","TOTAL","TOUCHWOOD","TPHQ",
    "TPLPLASTEH","TRACXN","TRANSPEK","TRANSRAILL","TRANSWORLD","TRAVELFOOD","TREEHOUSE","TREJHARA","TREL","TRENT",
    "TRF","TRIDENT","TRIGYN","TRITURBINE","TRIVENI","TRU","TRUALT","TSFINV","TTKHLTCARE","TTKPRESTIG",
    "TTL","TTML","TVSELECT","TVSHLTD","TVSMOTOR","TVSSCS","TVSSRICHAK","TVTODAY","TVVISION","UBL",
    "UCAL","UCOBANK","UDS","UEL","UFBL","UFLEX","UFO","UGARSUGAR","UGROCAP","UJJIVANSFB",
    "ULTRACEMCO","ULTRAMAR","UMAEXPORTS","UMIYA-MRO","UNICHEMLAB","UNIDT","UNIECOM","UNIENTER","UNIMECH","UNIONBANK",
    "UNIPARTS","UNITDSPR","UNITECH","UNITEDTEA","UNIVASTU","UNIVCABLES","UNOMINDA","UPL","URAVIDEF","URBANCO",
    "URJA","USHAMART","USK","UTIAMC","UTKARSHBNK","UTLSOLAR","UTTAMSUGAR","UYFINCORP","V2RETAIL","VADILALIND",
    "VAIBHAVGBL","VAKRANGEE","VALIANTORG","VARDHACRLC","VARROC","VASWANI","VBL","VCL","VEDL","VEEDOL",
    "VELJAN","VENKEYS","VENTIVE","VENUSPIPES","VENUSREM","VERANDA","VESUVIUS","VETO","VGL","VGUARD",
    "VHL","VIDHIING","VIDYAWIRES","VIJAYA","VIKASECO","VIKASLIFE","VIKRAMSOLR","VIKRAN","VIMTALABS","VINATIORGA",
    "VINCOFE","VINDHYATEL","VINNY","VINYLINDIA","VIPIND","VIPULLTD","VIRINCHI","VISAKAIND","VISHNU","VISHWARAJ",
    "VIVIDHA","VIYASH","VLSFINANCE","VMART","VMM","VOLTAMP","VOLTAS","VRAJ","VRLLOG","VSSL",
    "VSTIND","VSTL","VSTTILLERS","VTL","WAAREEENER","WAAREEINDO","WAAREERTL","WABAG","WAKEFIT","WALCHANNAG",
    "WANBURY","WCIL","WEALTH","WEBELSOLAR","WEIZMANIND","WEL","WELCORP","WELENT","WELSPLSOL","WELSPUNLIV",
    "WENDT","WESTLIFE","WEWORK","WHEELS","WHIRLPOOL","WILLAMAGOR","WIMPLAST","WINDLAS","WINDMACHIN","WIPL",
    "WIPRO","WOCKPHARMA","WONDERLA","WORTHPERI","WPIL","WSI","WSTCSTPAPR","XCHANGING","XELPMOC","XPROINDIA",
    "XTGLOBAL","YASHO","YATHARTH","YATRA","YESBANK","YUKEN","ZAGGLE","ZEEL","ZEELEARN","ZEEMEDIA",
    "ZENITHEXPO","ZENITHSTL","ZENSARTECH","ZENTEC","ZFCVINDIA","ZFSTEERING","ZODIACLOTH","ZOTA","ZSARACOM","ZUARI",
    "ZUARIIND","ZYDUSLIFE","ZYDUSWELL",
]

_seen = set()
NSE_EQUITY_UNIVERSE = [x for x in NSE_EQUITY_UNIVERSE if not (x in _seen or _seen.add(x))]
NIFTY_UNIVERSE = NSE_EQUITY_UNIVERSE  # alias used throughout


# ── DB helpers ─────────────────────────────────────────────────────────────────
def get_db():
    conn = sqlite3.connect(DB_PATH, timeout=30, check_same_thread=False)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=10000")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.row_factory = sqlite3.Row
    return conn

def _reset_db():
    """Delete corrupted DB files and start fresh."""
    import glob
    for f in glob.glob(DB_PATH + "*"):
        try:
            os.remove(f)
        except Exception:
            pass

def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    # Try to open; if corrupted, wipe and recreate
    try:
        conn = get_db()
        conn.execute("SELECT 1 FROM sqlite_master LIMIT 1")
        conn.close()
    except sqlite3.DatabaseError:
        _reset_db()
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS watchlist (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL UNIQUE,
            name TEXT,
            added_at TEXT DEFAULT CURRENT_TIMESTAMP,
            notes TEXT
        );
        CREATE TABLE IF NOT EXISTS portfolio (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            name TEXT,
            quantity REAL NOT NULL,
            buy_price REAL NOT NULL,
            buy_date TEXT,
            notes TEXT
        );
        CREATE TABLE IF NOT EXISTS stock_cache (
            symbol TEXT PRIMARY KEY,
            data TEXT,
            updated_at TEXT
        );
    """)
    conn.commit(); conn.close()

def get_yf_symbol(symbol):
    return f"{symbol}.NS"

# ── Field helpers ──────────────────────────────────────────────────────────────
def sr(val, dp=2):
    """Safe round — returns None on missing/error."""
    try: return round(float(val), dp) if val is not None else None
    except: return None

def sp(val, dp=2):
    """Safe percent (multiply by 100 then round)."""
    try: return round(float(val) * 100, dp) if val is not None else None
    except: return None

def cr(val, dp=0):
    """Convert absolute rupees → crores, rounded."""
    try: return round(float(val) / 1e7, dp) if val is not None else None
    except: return None


# ── Core fetch ────────────────────────────────────────────────────────────────
def fetch_stock_info(symbol):
    """
    Pull 65+ fields from Yahoo Finance for a single NSE stock.
    Results cached in SQLite for 1 hour to avoid hammering Yahoo.
    New fields vs previous version:
      Graham Number, Graham MoS, FCF Yield, Earnings Yield,
      Working Capital, Cash Conversion Cycle, Operating Leverage,
      52W % from High/Low, SMA crossover flags, EV/GP,
      Net Debt/EBITDA, Debt/Assets, Equity Multiplier,
      Operating CF Margin, Capex intensity.
    """
    conn = get_db()
    row = conn.execute("SELECT data, updated_at FROM stock_cache WHERE symbol=?", (symbol,)).fetchone()
    if row:
        if datetime.now() - datetime.fromisoformat(row["updated_at"]) < timedelta(hours=1):
            conn.close()
            return json.loads(row["data"])
    try:
        ticker = yf.Ticker(get_yf_symbol(symbol))
        i = ticker.info

        # ── Price & Market ──────────────────────────────────────────────
        price      = i.get("currentPrice") or i.get("regularMarketPrice")
        mktcap     = i.get("marketCap")
        ev         = i.get("enterpriseValue")
        shares_out = i.get("sharesOutstanding")
        float_sh   = i.get("floatShares")

        # ── Income ─────────────────────────────────────────────────────
        revenue    = i.get("totalRevenue")
        gp         = i.get("grossProfits")
        ebitda     = i.get("ebitda")
        net_inc    = i.get("netIncomeToCommon")
        op_cf      = i.get("operatingCashflow")
        fcf        = i.get("freeCashflow")
        total_cash = i.get("totalCash")
        total_debt = i.get("totalDebt")
        total_assets = i.get("totalAssets")

        net_debt   = sr((total_debt or 0) - (total_cash or 0), 0)

        # ── Margins ─────────────────────────────────────────────────────
        gross_margin  = sp(i.get("grossMargins"))
        ebitda_margin = sp(i.get("ebitdaMargins"))
        op_margin     = sp(i.get("operatingMargins"))
        net_margin    = sp(i.get("profitMargins"))
        opcf_margin   = sr(op_cf / revenue * 100, 2) if op_cf and revenue and revenue > 0 else None

        # ── Valuation ───────────────────────────────────────────────────
        pe  = sr(i.get("trailingPE"), 2)
        pef = sr(i.get("forwardPE"), 2)
        pb  = sr(i.get("priceToBook"), 2)
        ps  = sr(i.get("priceToSalesTrailing12Months"), 2)
        peg = sr(i.get("pegRatio"), 2)
        ev_ebitda = sr(i.get("enterpriseToEbitda"), 2)
        ev_rev    = sr(i.get("enterpriseToRevenue"), 2)
        ev_gp     = sr(ev / gp, 2) if ev and gp and gp > 0 else None

        # Price-to-FCF
        pfcf = None
        if fcf and price and shares_out and shares_out > 0:
            fcf_ps = fcf / shares_out
            if fcf_ps > 0: pfcf = sr(price / fcf_ps, 2)

        # Derived yields
        fcf_yield  = sr(fcf  / mktcap * 100, 2) if fcf  and mktcap and mktcap > 0 else None
        earn_yield = sr(100  / pe,            2) if pe   and pe    > 0            else None

        # ── Per-Share ────────────────────────────────────────────────────
        eps     = sr(i.get("trailingEps"), 2)
        eps_fwd = sr(i.get("forwardEps"), 2)
        bv      = sr(i.get("bookValue"), 2)
        rev_ps  = sr(i.get("revenuePerShare"), 2)
        cash_ps = sr(i.get("totalCashPerShare"), 2)

        # ── Returns ──────────────────────────────────────────────────────
        roe = sp(i.get("returnOnEquity"))
        roa = sp(i.get("returnOnAssets"))

        # ROCE
        roce = None
        try:
            eq_total = (bv or 0) * (shares_out or 0)
            cap_emp  = eq_total + (total_debt or 0)
            ebit_est = (op_margin or 0) / 100 * (revenue or 0)
            if cap_emp > 0 and ebit_est: roce = sr(ebit_est / cap_emp * 100, 2)
        except: pass

        # ── Leverage & Solvency ───────────────────────────────────────────
        de         = sr(i.get("debtToEquity"), 2)
        debt_assets = sr(total_debt / total_assets, 4) if total_debt and total_assets and total_assets > 0 else None
        eq_mult     = sr(total_assets / ((bv or 0) * (shares_out or 0)), 2) if total_assets and bv and shares_out and bv * shares_out > 0 else None
        nd_ebitda   = sr(net_debt / ebitda, 2) if net_debt and ebitda and ebitda > 0 else None

        # Interest coverage
        int_cov = None
        try:
            inc_stmt = ticker.income_stmt
            if not inc_stmt.empty:
                latest = inc_stmt.iloc[:, 0]
                ebit = latest.get("EBIT") or latest.get("Operating Income")
                ie   = latest.get("Interest Expense")
                if ebit and ie and ie != 0: int_cov = sr(abs(ebit / ie), 2)
        except: pass

        # ── Liquidity ────────────────────────────────────────────────────
        curr_r  = sr(i.get("currentRatio"), 2)
        quick_r = sr(i.get("quickRatio"), 2)

        # ── Efficiency ───────────────────────────────────────────────────
        asset_turn  = sr(revenue / total_assets, 2) if revenue and total_assets and total_assets > 0 else None
        inv_turn    = None
        rec_days    = None
        pay_days    = None
        wc_cr       = None
        ccc         = None
        capex_rev   = None

        try:
            bs = ticker.balance_sheet
            if not bs.empty:
                lb  = bs.iloc[:, 0]
                inv = lb.get("Inventory")
                ar  = lb.get("Accounts Receivable") or lb.get("Net Receivables")
                ap  = lb.get("Accounts Payable")
                ca  = lb.get("Current Assets")
                cl  = lb.get("Current Liabilities")
                wc_cr = sr((ca - cl) / 1e7, 2) if ca is not None and cl is not None else None
                cogs  = (1 - (i.get("grossMargins") or 0)) * (revenue or 0)
                if inv and cogs and cogs > 0: inv_turn = sr(cogs / inv, 2)
                inv_days = sr(inv / cogs * 365, 1) if inv and cogs and cogs > 0 else None
                if ar  and revenue and revenue > 0: rec_days = sr(ar / revenue * 365, 1)
                if ap  and cogs    and cogs    > 0: pay_days = sr(ap / cogs    * 365, 1)
                if rec_days and pay_days: ccc = sr(rec_days + (inv_days or 0) - pay_days, 1)
        except: pass

        try:
            cf = ticker.cashflow
            if not cf.empty:
                lc = cf.iloc[:, 0]
                capex = lc.get("Capital Expenditure")
                if capex and revenue and revenue > 0:
                    capex_rev = sr(abs(capex) / revenue * 100, 2)
        except: pass

        # ── Growth ───────────────────────────────────────────────────────
        rev_gr   = sp(i.get("revenueGrowth"))
        earn_gr  = sp(i.get("earningsGrowth"))
        earn_qgr = sp(i.get("earningsQuarterlyGrowth"))

        # ── Operating Leverage ────────────────────────────────────────────
        op_lev = sr(gross_margin / op_margin, 2) if gross_margin and op_margin and op_margin > 0 else None

        # ── Graham Number & MoS ───────────────────────────────────────────
        graham = None
        graham_mos = None
        if eps and bv and eps > 0 and bv > 0:
            try:
                graham = sr(math.sqrt(22.5 * eps * bv), 2)
                if price and graham: graham_mos = sr((graham - price) / graham * 100, 2)
            except: pass

        # ── 52W position ─────────────────────────────────────────────────
        h52 = sr(i.get("fiftyTwoWeekHigh"), 2)
        l52 = sr(i.get("fiftyTwoWeekLow"), 2)
        sma50  = sr(i.get("fiftyDayAverage"), 2)
        sma200 = sr(i.get("twoHundredDayAverage"), 2)
        beta   = sr(i.get("beta"), 2)
        day_ch = sr(i.get("regularMarketChangePercent"), 2)

        from_h = sr((price - h52) / h52 * 100, 2) if price and h52 and h52 > 0 else None
        from_l = sr((price - l52) / l52 * 100, 2) if price and l52 and l52 > 0 else None
        above_sma50  = bool(price > sma50)  if price and sma50  else None
        above_sma200 = bool(price > sma200) if price and sma200 else None

        # ── Shareholding ─────────────────────────────────────────────────
        promo_hold = sp(i.get("heldPercentInsiders"))
        inst_hold  = sp(i.get("heldPercentInstitutions"))
        float_pct  = sr(float_sh / shares_out * 100, 2) if float_sh and shares_out and shares_out > 0 else None
        short_pct  = sp(i.get("shortPercentOfFloat"))
        short_rat  = sr(i.get("shortRatio"), 2)

        # ── Dividend ─────────────────────────────────────────────────────
        div_yield  = sp(i.get("dividendYield"))
        div_rate   = sr(i.get("dividendRate"), 2)
        payout     = sp(i.get("payoutRatio"))

        data = {
            # Identity
            "symbol":    symbol,
            "name":      i.get("longName") or i.get("shortName", symbol),
            "sector":    i.get("sector", "N/A"),
            "industry":  i.get("industry", "N/A"),
            "description": i.get("longBusinessSummary", ""),
            "website":   i.get("website", ""),
            "employees": i.get("fullTimeEmployees"),
            "country":   i.get("country", "India"),
            "currency":  i.get("currency", "INR"),
            "exchange":  "NSE" if i.get("exchange") in (None, "", "NSI") else i.get("exchange"),

            # Price & Market
            "current_price":      sr(price, 2),
            "day_change":         day_ch,
            "market_cap":         mktcap,
            "market_cap_cr":      cr(mktcap),
            "enterprise_value":   ev,
            "enterprise_value_cr":cr(ev),
            "52w_high":           h52,
            "52w_low":            l52,
            "52w_from_high_pct":  from_h,
            "52w_from_low_pct":   from_l,
            "sma_50":             sma50,
            "sma_200":            sma200,
            "above_sma50":        above_sma50,
            "above_sma200":       above_sma200,
            "beta":               beta,

            # P&L (absolute ₹)
            "revenue":            revenue,
            "revenue_cr":         cr(revenue),
            "gross_profit":       gp,
            "gross_profit_cr":    cr(gp),
            "ebitda":             ebitda,
            "ebitda_cr":          cr(ebitda),
            "net_profit":         net_inc,
            "net_profit_cr":      cr(net_inc),
            "operating_cf":       op_cf,
            "operating_cf_cr":    cr(op_cf),
            "free_cashflow":      fcf,
            "fcf_cr":             cr(fcf),
            "total_cash":         total_cash,
            "total_cash_cr":      cr(total_cash),
            "total_debt":         total_debt,
            "total_debt_cr":      cr(total_debt),
            "net_debt":           net_debt,
            "net_debt_cr":        cr(net_debt) if net_debt else None,
            "total_assets":       total_assets,
            "total_assets_cr":    cr(total_assets),
            "working_capital_cr": wc_cr,

            # Per-Share
            "eps":                eps,
            "eps_forward":        eps_fwd,
            "book_value":         bv,
            "revenue_per_share":  rev_ps,
            "cash_per_share":     cash_ps,

            # Valuation
            "pe_ratio":           pe,
            "pe_forward":         pef,
            "pb_ratio":           pb,
            "ps_ratio":           ps,
            "peg_ratio":          peg,
            "ev_ebitda":          ev_ebitda,
            "ev_revenue":         ev_rev,
            "ev_gross_profit":    ev_gp,
            "price_to_fcf":       pfcf,
            "fcf_yield":          fcf_yield,
            "earnings_yield":     earn_yield,
            "graham_number":      graham,
            "graham_mos":         graham_mos,

            # Margins
            "gross_margin":       gross_margin,
            "ebitda_margin":      ebitda_margin,
            "operating_margin":   op_margin,
            "net_margin":         net_margin,
            "opcf_margin":        opcf_margin,

            # Returns
            "roe":                roe,
            "roa":                roa,
            "roce":               roce,

            # Liquidity
            "current_ratio":      curr_r,
            "quick_ratio":        quick_r,

            # Leverage & Solvency
            "debt_to_equity":     de,
            "debt_to_assets":     debt_assets,
            "equity_multiplier":  eq_mult,
            "net_debt_ebitda":    nd_ebitda,
            "interest_coverage":  int_cov,
            "op_leverage":        op_lev,

            # Efficiency
            "asset_turnover":     asset_turn,
            "inventory_turnover": inv_turn,
            "receivable_days":    rec_days,
            "payable_days":       pay_days,
            "cash_conv_cycle":    ccc,
            "capex_to_revenue":   capex_rev,

            # Growth
            "revenue_growth":     rev_gr,
            "earnings_growth":    earn_gr,
            "earnings_q_growth":  earn_qgr,

            # Dividend
            "dividend_yield":     div_yield,
            "dividend_rate":      div_rate,
            "payout_ratio":       payout,

            # Shareholding
            "promoter_holding":       promo_hold,
            "institutional_holding":  inst_hold,
            "float_pct":              float_pct,
            "shares_outstanding":     shares_out,
            "short_pct":              short_pct,
            "short_ratio":            short_rat,
        }

        conn.execute("INSERT OR REPLACE INTO stock_cache (symbol, data, updated_at) VALUES (?,?,?)",
                     (symbol, json.dumps(data), datetime.now().isoformat()))
        conn.commit(); conn.close()
        return data

    except Exception as e:
        conn.close()
        return {"symbol": symbol, "error": str(e)}


# ── Routes ────────────────────────────────────────────────────────────────────

@app.route("/api/health")
def health():
    return jsonify({"status":"ok","time":datetime.now().isoformat(),"universe":len(NIFTY_UNIVERSE)})

@app.route("/api/search")
def search():
    q = request.args.get("q","").upper().strip()
    if len(q) < 1: return jsonify([])
    matches = [s for s in NIFTY_UNIVERSE if q in s][:20]
    conn = get_db()
    results = []
    for sym in matches:
        row = conn.execute("SELECT data FROM stock_cache WHERE symbol=?", (sym,)).fetchone()
        if row:
            d = json.loads(row["data"])
            results.append({"symbol":sym,"name":d.get("name",sym),"sector":d.get("sector",""),"current_price":d.get("current_price")})
        else:
            results.append({"symbol":sym,"name":sym,"sector":""})
    conn.close()
    return jsonify(results)

@app.route("/api/universe")
def universe():
    return jsonify(NIFTY_UNIVERSE)

@app.route("/api/screen")
def screen():
    F = {
        k: request.args.get(k, type=float) for k in [
            "min_pe","max_pe","min_pb","max_pb","min_ps","max_ps",
            "min_roe","max_roe","min_roa","min_roce",
            "min_mcap","max_mcap","min_div","min_net_margin",
            "max_de","min_current_ratio","min_rev_growth","min_earn_growth",
            "max_ev_ebitda","min_fcf_yield","min_graham_mos",
        ]
    }
    F["sector"]      = request.args.get("sector","")
    F["above_sma200"]= request.args.get("above_sma200","")
    limit    = request.args.get("limit",500,type=int)
    sort_by  = request.args.get("sort_by","market_cap_cr")
    sort_dir = request.args.get("sort_dir","desc")

    conn = get_db()
    rows = conn.execute("SELECT data FROM stock_cache").fetchall()
    conn.close()

    results = []
    for row in rows:
        d = json.loads(row["data"])
        if "error" in d: continue
        def chk(k, mn=None, mx=None):
            v = d.get(k)
            if mn is not None and (v is None or v < mn): return False
            if mx is not None and (v is None or v > mx): return False
            return True
        if not chk("pe_ratio",       F["min_pe"],            F["max_pe"]):          continue
        if not chk("pb_ratio",       F["min_pb"],            F["max_pb"]):          continue
        if not chk("ps_ratio",       F["min_ps"],            F["max_ps"]):          continue
        if not chk("roe",            F["min_roe"],           F["max_roe"]):         continue
        if not chk("roa",            F["min_roa"],           None):                 continue
        if not chk("roce",           F["min_roce"],          None):                 continue
        if not chk("market_cap_cr",  F["min_mcap"],          F["max_mcap"]):        continue
        if not chk("dividend_yield", F["min_div"],           None):                 continue
        if not chk("net_margin",     F["min_net_margin"],    None):                 continue
        if not chk("debt_to_equity", None,                   F["max_de"]):          continue
        if not chk("current_ratio",  F["min_current_ratio"], None):                 continue
        if not chk("revenue_growth", F["min_rev_growth"],    None):                 continue
        if not chk("earnings_growth",F["min_earn_growth"],   None):                 continue
        if not chk("ev_ebitda",      None,                   F["max_ev_ebitda"]):   continue
        if not chk("fcf_yield",      F["min_fcf_yield"],     None):                 continue
        if not chk("graham_mos",     F["min_graham_mos"],    None):                 continue
        if F["above_sma200"] == "true" and not d.get("above_sma200"):              continue
        if F["sector"] and d.get("sector","").lower() != F["sector"].lower():      continue
        results.append(d)

    results.sort(key=lambda x:(x.get(sort_by) or 0), reverse=(sort_dir=="desc"))
    return jsonify({"count":len(results),"results":results[:limit] if limit>0 else results,"cached_total":len(rows)})

@app.route("/api/company/<symbol>")
def company(symbol):
    symbol = symbol.upper()
    data = fetch_stock_info(symbol)
    if "error" in data: return jsonify(data), 404
    try:
        ticker = yf.Ticker(get_yf_symbol(symbol))
        hist = ticker.history(period="1y", interval="1d")
        ph = []
        if not hist.empty:
            for date, row in hist.iterrows():
                ph.append({"date":date.strftime("%Y-%m-%d"),
                            "open":round(float(row["Open"]),2),"high":round(float(row["High"]),2),
                            "low":round(float(row["Low"]),2),  "close":round(float(row["Close"]),2),
                            "volume":int(row["Volume"]) if row["Volume"] else 0})
        fin = {}
        for attr,key in [("financials","income"),("balance_sheet","balance"),("cashflow","cashflow")]:
            try:
                df = getattr(ticker, attr)
                if not df.empty:
                    t = df.T; t.index=[str(x)[:4] for x in t.index]
                    fin[key] = t.fillna(0).to_dict()
            except: pass
        try:
            q = ticker.quarterly_income_stmt
            if not q.empty:
                t = q.T; t.index=[str(x)[:7] for x in t.index]
                fin["quarterly"] = t.fillna(0).to_dict()
        except: pass
        data["price_history"] = ph
        data["financials"]    = fin
    except:
        data["price_history"] = []
        data["financials"]    = {}
    return jsonify(data)

@app.route("/api/bulk-fetch", methods=["POST"])
def bulk_fetch():
    body = request.get_json()
    symbols = body.get("symbols", NIFTY_UNIVERSE[:50])
    res = {"success":[],"failed":[],"total":len(symbols)}
    for sym in symbols:
        try:
            d = fetch_stock_info(sym)
            (res["success"] if "error" not in d else res["failed"]).append(sym)
        except: res["failed"].append(sym)
        time.sleep(0.3)
    return jsonify(res)

@app.route("/api/watchlist", methods=["GET"])
def get_watchlist():
    conn = get_db()
    rows = conn.execute("SELECT * FROM watchlist ORDER BY added_at DESC").fetchall()
    conn.close()
    result = []
    for r in rows:
        h = dict(r)
        info = fetch_stock_info(h["symbol"])
        for k in ["current_price","day_change","sector","market_cap","pe_ratio","roe",
                  "revenue_growth","earnings_growth","net_margin","dividend_yield",
                  "market_cap_cr","52w_from_high_pct","above_sma200"]:
            h[k] = info.get(k)
        result.append(h)
    return jsonify(result)

@app.route("/api/watchlist", methods=["POST"])
def add_to_watchlist():
    body = request.get_json()
    symbol = body.get("symbol","").upper()
    if not symbol: return jsonify({"error":"symbol required"}), 400
    info = fetch_stock_info(symbol)
    name = info.get("name", symbol)
    conn = get_db()
    if conn.execute("SELECT id FROM watchlist WHERE symbol=?", (symbol,)).fetchone():
        conn.close(); return jsonify({"error":"Already in watchlist"}), 409
    conn.execute("INSERT OR IGNORE INTO watchlist (symbol, name, notes) VALUES (?,?,?)",
                 (symbol, name, body.get("notes","")))
    conn.commit(); conn.close()
    return jsonify({"success":True,"symbol":symbol,"name":name})

@app.route("/api/watchlist/<int:item_id>", methods=["DELETE"])
def remove_from_watchlist(item_id):
    conn = get_db()
    conn.execute("DELETE FROM watchlist WHERE id=?", (item_id,))
    conn.commit(); conn.close()
    return jsonify({"success":True})

@app.route("/api/portfolio", methods=["GET"])
def get_portfolio():
    conn = get_db()
    rows = conn.execute("SELECT * FROM portfolio ORDER BY id DESC").fetchall()
    conn.close()
    result = []
    for h in [dict(r) for r in rows]:
        info = fetch_stock_info(h["symbol"])
        cp = info.get("current_price")
        h.update({"current_price":cp,"name":info.get("name",h["symbol"])})
        if cp and h["buy_price"]:
            h["pnl"]           = round((cp-h["buy_price"])*h["quantity"],2)
            h["pnl_pct"]       = round((cp-h["buy_price"])/h["buy_price"]*100,2)
            h["current_value"] = round(cp*h["quantity"],2)
        result.append(h)
    return jsonify(result)

@app.route("/api/portfolio", methods=["POST"])
def add_to_portfolio():
    body = request.get_json()
    sym = body.get("symbol","").upper()
    qty = body.get("quantity"); bp = body.get("buy_price")
    if not sym or not qty or not bp:
        return jsonify({"error":"symbol, quantity, buy_price required"}), 400
    info = fetch_stock_info(sym)
    conn = get_db()
    conn.execute("INSERT INTO portfolio (symbol,name,quantity,buy_price,buy_date,notes) VALUES (?,?,?,?,?,?)",
                 (sym, info.get("name",sym), qty, bp, body.get("buy_date",""), body.get("notes","")))
    conn.commit(); conn.close()
    return jsonify({"success":True})

@app.route("/api/portfolio/<int:item_id>", methods=["DELETE"])
def remove_from_portfolio(item_id):
    conn = get_db()
    conn.execute("DELETE FROM portfolio WHERE id=?", (item_id,))
    conn.commit(); conn.close()
    return jsonify({"success":True})

@app.route("/api/sectors")
def get_sectors():
    conn = get_db()
    rows = conn.execute("SELECT data FROM stock_cache").fetchall()
    conn.close()
    sectors = set()
    for row in rows:
        d = json.loads(row["data"])
        if d.get("sector") and d["sector"] not in ("N/A",""):
            sectors.add(d["sector"])
    return jsonify(sorted(sectors))


_BASE_DIR = os.path.dirname(os.path.abspath(__file__))

@app.route("/")
@app.route("/index.html")
def serve_index():
    return send_from_directory(_BASE_DIR, "index.html")

@app.route("/company.html")
def serve_company():
    return send_from_directory(_BASE_DIR, "company.html")

@app.route("/watchlist.html")
def serve_watchlist():
    return send_from_directory(_BASE_DIR, "watchlist.html")


if __name__ == "__main__":
    init_db()
    print(f"\n🚀  MFC Screener  →  http://localhost:5001")
    print(f"📊  NSE universe : {len(NIFTY_UNIVERSE)} stocks (full EQ series)")
    print(f"📈  Data fields  : 65+ fundamentals & derived metrics\n")
    app.run(host="0.0.0.0", port=5001, debug=False)
