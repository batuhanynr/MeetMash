# MeetMesh — 5 Aşamalı Geliştirme Planı ve GitHub Issue Listesi

**Sürüm:** 1.0  
**Hazırlanma tarihi:** 4 Kasım 2026  
**Durum:** Uygulama planı; aşağıdaki özelliklerin tamamlandığı veya testlerin çalıştırıldığı anlamına gelmez.  
**Hedef platform:** Flutter / iOS + Android  
**Referans ajan ve servisler:** Node.js + TypeScript  
**Sunum:** Dersin 10. haftası. Kesin takvim tarihi bu planda varsayılmamıştır.  
**İş kırılımı:** 5 milestone, 27 issue. Bu doküman GitHub'da issue açmaz; aktarılacak içerikleri tanımlar.

> **Ana kural:** Bir aşama, yalnızca kod yazıldığı için bitmiş sayılmaz. Aşama sonundaki demo tekrar çalıştırılmalı, geçiş testleri geçmeli ve kanıtlar aynı kod sürümüyle saklanmalıdır.

## 1. Bir bakışta

| Aşama | Sonunda elimizde ne olacak? | Ekranda / testte ne göreceğiz? | Issue'lar |
|---|---|---|---|
| **M1 — Ajanlar konuşuyor** | Üç bağımsız ajan ve çalışan mesaj protokolü | A → B/C mesaj akışı, ACK, yeniden gönderim, tek işleme | MM-101–105 |
| **M2 — Ajanlar bulunuyor ve mesaj bekliyor** | Directory, Registrar ve kalıcı çevrimdışı kuyruk | İsimden ajan bulma; C kapalıyken bekleyen mesajın geri dönünce ulaşması | MM-201–205 |
| **M3 — Ajanlar toplantı ayarlıyor** | Sahte takvimlerle gerçek müzakere ve ortak saat seçimi | Aynı toplantının üç takvimde tek kayıt olması; uygun saat yoksa açık ret | MM-301–305 |
| **M4 — Sistem kötü ağda sınanıyor** | Air üzerinde tekrarlanabilir ağ deneyleri ve ölçüm raporu | Gecikme, kayıp, kopma ve geri dönüş altında sonuçlar / hata durumları | MM-401–405 |
| **M5 — Kullanıcı telefondan kullanıyor** | Flutter, doğal dil, anlamsal keşif ve Google Calendar | Telefondan istek → ajan müzakeresi → onay → gerçek takvim kaydı | MM-501–507 |

**Ana bağımlılık:** M1 → M2 → M3 → M4 → M5.

**İki erken kontrol:** MM-401'deki Air erişimi ile MM-501'deki Android/iOS derleme kontrolü M1 sırasında başlayabilir. Bunların teknik erişim sorunlarını son aşamada keşfetmeyin.

**AI için erken küçük çıktı:** MM-504'ün metin → doğrulanmış istek kısmı, protokol şeması netleşince mobil uygulamayı beklemeden CLI üzerinden geliştirilebilir. M1–M4 tek başına tamamlandığında proje henüz AI entegrasyonunu bitirmiş sayılmaz.

---

## 2. Kaynaktan gelen gereklilikler ve bu planın kararları

### 2.1. Proje önerisi / ders yönergesinden gelenler

Aşağıdakiler yeni kapsam önerisi değil, mevcut belgelerdeki hedeflerdir. [P1][P2][P3]

- Agent Directory: isim veya yeteneğe göre ajan keşfi, anlamsal eşleştirme, kısa süreli önbellek ve bulunabilirlik kontrolü.
- Agent Communication Layer: TCP üzerinde adresleme, standart mesajlar, ACK / timeout / tekrar gönderim ve güvenlik.
- Mesajlar: `REQUEST`, `PROPOSE`, `ACCEPT`, `REJECT`, `CONFIRM`, `ACK`.
- Registrar: sabit ajan kimliğinin erişim bilgisine bağlanması ve çevrimdışı mesajların bekletilmesi.
- Kişisel ajanlar: müsaitlik ve tercihlerden ortak saat seçimi; herkesin onayından sonra takvimlere kayıt.
- Mobil uygulama: profil, arkadaş bulma, toplantı isteği ve takvim görünümü.
- AI: doğal dili isteğe dönüştürme ve anlamsal ajan keşfi.
- Gizlilik: mevcut takvimlerin başlık / açıklamalarını diğer ajanlara göndermemek; gerekli müsaitlik bilgisini paylaşmak.
- Kod ve deney sonuçları üretmek; mesaj gecikmesi, kayıp ve çevrimdışı ajan senaryolarını göstermek.

### 2.2. Bu dokümanda önerilen uygulama kararları

**Aşağıdaki teknoloji, eşik, test sayısı ve mimari ayrıntılar hocanın verdiği zorunlu standartlar değildir.** Bunlar iki kişilik ekibin uygulamaya başlayabilmesi için önerilen başlangıç kararlarıdır.

| Karar | Uygulama yaklaşımı |
|---|---|
| Mobil | Flutter. Mevcut iOS kurulumundan yararlan; Android araç zincirini erken doğrula. |
| Sunucu ve referans ajanlar | Node.js + TypeScript. İlk dört aşamada üç ayrı ajan süreci çalışır. |
| Mesaj taşıma | JSON mesajları WSS üzerinden; ilk yerel geliştirmede yalnız loopback üzerinde WS kabul edilebilir. |
| Hub | Directory + Registrar + relay / posta kutusu aynı servis içinde modüler tutulur. Başlangıçta ayrı mikroservisler yoktur. |
| Kalıcılık | Hub için PostgreSQL; referans ajanların inbox / outbox / toplantı durumu için yerel SQLite. Redis ilk sürüm için zorunlu değildir. |
| Mobil ajan | Son aşamada aynı protokolü konuşan Dart istemcisi ve ajan mantığı. TypeScript kodunun Flutter'da doğrudan çalıştığı varsayılmaz. |
| AI erişimi | Model sağlayıcısı bir adaptör arkasında; servis anahtarları mobil uygulamaya gömülmez. |
| Ağ deneyleri | NVIDIA DSX Air üzerinde Linux düğümler; NetEm ve uygulama seviyesinde kontrollü hata enjeksiyonu. |
| Saatler | Tel üzerinde açık ofsetli / UTC zamanlar; kullanıcı saat dilimi ayrıca taşınır. Demo görünümü `Europe/Istanbul`. |
| Bağımlılıklar | Geliştirme başlangıcında uygun güncel kararlı sürümler seçilir. Deney kaydına kullanılan gerçek sürümler ve lockfile / commit bilgisi yazılır. |

### 2.3. Öneri çizimiyle uygulama arasındaki farkı açık tut

**Registrar:** Önerideki `agent ID → IP/port` eşlemesi uygulamada `agent ID → doğrulanmış aktif bağlantı/session + son görülme + uç bilgisi` olarak gerçekleştirilecek. Ajanlar hub'a kendileri bağlanacak; mesajlar bu bağlantılar üzerinden aktarılacak. Bu, özgün önerinin birebir doğrudan IP bağlantısı değil, **relay kullanan uygulama uyarlamasıdır**. MM-101'de gerekçesi ve sınırı yazılmalı; raporda doğrudan P2P yapılmış gibi anlatılmamalıdır.

**Ajanın nerede çalıştığı:** M1–M4'teki Node süreçleri deney ajanlarıdır. M5 hedefinde Flutter istemcisi de gerçek bir protokol katılımcısıdır. Telefon yalnızca merkezi bir toplantı API'sine form gönderip geri çekilmeyecek; en azından müsaitlik, öneri, kabul ve onay akışına katılacaktır. Bütün ajanları kalıcı olarak sunucuya taşımak daha sonra seçilirse bu ayrı mimari karar ve öneri sapması olarak kaydedilmelidir.

**Telefonun arka planı:** İlk mobil kapsam, ön planda çalışan ajan + bağlantı koptuğunda kuyruk + tekrar açıldığında devam etmedir. Kesintisiz arka plan ajanı ve push ile uyandırma bu planın geçiş şartı değildir.

**Güvenlik sınırı:** TLS, bağlantıları korur; bu relay mimarisinde kendi başına ajanlar arası uçtan uca içerik şifrelemesi iddiası kurulmaz. Hub yalnız gerekli protokol verilerini görür. MAC, içerik bütünlüğü / kimlik doğrulama amacıyla uygulanır; şifreleme yerine sunulmaz.

---

## 3. Issue ve milestone kullanım kuralları

### 3.1. GitHub'a aktarım

Beş milestone'u yukarıdaki adlarla oluşturun. Her `MM-xxx` bölümü bir GitHub issue'su olacak.

Örnek başlık: **`[M1][MM-102] Mesaj sözleşmesini ve doğrulayıcıyı oluştur`**

`MM-xxx` kodları bu dokümanın kalıcı referanslarıdır; GitHub'ın vereceği `#issue` numaraları değildir. Aktarım sonrası bağımlılık alanlarına gerçek issue bağlantıları eklenebilir.

Önerilen etiketler: `protocol`, `backend`, `agent`, `mobile`, `ai`, `calendar`, `security`, `network-lab`, `test`, `docs`. `blocked` yalnız gerçekten engellenen işlerde kullanılır.

Her issue için bir sorumlu ve diğer ekip üyesinden bir inceleyen seçin. Burada kişilere görev atanmış değildir.

### 3.2. Ortak tamamlanma tanımı

Aşağıdaki şartlar **her issue için** geçerlidir:

- [ ] Issue'nun kabul kriterleri otomatik test veya tarif edilmiş tekrarlanabilir manuel test ile doğrulandı.
- [ ] Değişiklik ana geliştirme dalına inceleme sonrası alındı.
- [ ] Kurulum / çalıştırma / hata ayıklama bilgisi ilgili README'ye eklendi.
- [ ] Secret, OAuth token, kişisel takvim içeriği veya gerçek özel anahtar repoya / rapora girmedi.
- [ ] İlgili test logu, ekran kaydı veya makine tarafından okunabilir sonuç kaydedildi.
- [ ] Önceki aşamaların ilgili regresyon testleri geçiyor.
- [ ] Kanıtta commit SHA, ortam ve kullanılan test verisi belirtiliyor.

**Milestone tamamlanması:** İlgili issue'lar ve aşama sonundaki bütün zorunlu geçiş kriterleri tamamlanmış olmalı. Engellenmiş bir gerçek entegrasyon, mock ile çalışıyor diye tamamlandı işaretlenmez.

### 3.3. Önerilen depo düzeni

```text
apps/
  hub/                    # Directory, Registrar, relay, AI proxy
  agent-node/             # Bağımsız Node referans ajanı
  mobile/                 # Flutter uygulaması ve Dart ajan modülleri
packages/
  protocol/               # Dil-bağımsız JSON şemaları ve test vektörleri
  scheduler-ts/           # Referans seçim / müzakere mantığı
fixtures/
  agents/
  calendars/
  ai/
tests/
  protocol/
  integration/
  conformance/            # Node ve Dart aynı örneklerde aynı sonucu veriyor mu?
  scenarios/
infra/
  local/
  air/
docs/
  decisions/
  demos/
  evidence/               # Küçük, temizlenmiş kanıtlar; büyük video release eki olabilir
```

### 3.4. Ortak gözlemlenebilirlik

Her test çalıştırması bir `runId`, her toplantı bir `meetingId`, her mantıksal mesaj bir `messageId` taşır.

Yapılandırılmış loglarda en az şu alanlar olur:

```text
timestamp, runId, agentId, meetingId, messageId,
messageType, direction, event, attempt, outcome
```

Örnek olaylar: `message.sent`, `message.queued`, `message.received`, `message.acked`,
`message.retried`, `message.duplicate`, `agent.offline`, `agent.online`,
`meeting.selected`, `meeting.committed`, `calendar.created`, `meeting.failed`.

**Görünürlük ile gizlilik birlikte:** Varsayılan loglarda ham takvim, token ve tam doğal dil girdisi yoktur. Debug dökümleri yalnız sentetik test verisiyle üretilir.

### 3.5. Test / demo komutlarının durumu

Aşağıdaki isimler **geliştirilecek komut arayüzüdür**, şu anda mevcut / çalıştırılmış komutlar değildir:

```text
demo:m1 ... demo:m5
test:gate:m1 ... test:gate:m5
test:regression
lab:apply <profile>
lab:reset
bench:network
```

Komutlar uygulandığında tek bir README'den nasıl çağrıldıkları anlaşılmalı; başarılı test çıkış kodu `0`, başarısız test sıfır dışı olmalıdır.

---

## 4. Protokol için ortak kurallar

Bu bölüm issue'lar arasında çelişki olmaması için başlangıç sözleşmesidir. Ayrıntılı şema MM-102'de üretilecek.

### 4.1. Mesaj zarfı

```json
{
  "protocolVersion": "1",
  "messageId": "unique-logical-message-id",
  "meetingId": "unique-meeting-id",
  "fromAgentId": "agent-a",
  "toAgentId": "agent-b",
  "type": "REQUEST",
  "sequence": 1,
  "createdAt": "2026-11-10T06:00:00Z",
  "expiresAt": "2026-11-10T06:03:00Z",
  "nonce": "unique-per-new-logical-message",
  "payload": {},
  "auth": {}
}
```

`auth` yapısı MM-204'te kesinleştirilecek. Kimlikler örnektir; gerçek bir gönderilebilir istek değildir.

**Tekrar gönderim:** Aynı mantıksal mesaj aynı `messageId`, nonce ve imzalanan içerikle gönderilir. Deneme sayısı mesajın iş anlamını değiştirmez; log / taşıma metadatasında tutulur.

**Grup gönderimi:** Her alıcı için ayrı mesaj ve ayrı teslim durumu vardır. Bir kişinin ACK'i grubun tamamının ACK'i sayılmaz.

### 4.2. ACK ile toplantı onayını karıştırma

| Olay | Anlamı | Anlamına gelmediği |
|---|---|---|
| `ACK`, scope=`relay.persisted` | Hub mesajı kalıcı kuyruğa aldı; teslim sorumluluğunu üstlendi | Alıcı çevrimiçi veya toplantı kabul edildi değil |
| `ACK`, scope=`recipient.persisted` | Alıcı mesajı kalıcı inbox'a aldı; işleyecek | Saat kabul edildi veya takvime yazıldı değil |
| `ACCEPT` | Belirtilen öneri / rezervasyon iş kuralı açısından kabul edildi | Sadece ağ teslim bildirimi değil |
| `CONFIRM` | Müzakerenin belirlenmiş aşamasına ait karar / uygulama sonucu | Tek başına bütün takvimlerin başarılı yazıldığının kanıtı değil |

ACK mesajı başka ACK istemez. ACK'in hangi mesajı onayladığı açıkça belirtilir. Kalıcı inbox'a alınan iş, süreç yeniden başladıktan sonra yeniden yürütülebilmelidir.

**Garanti hedefi:** Tekrar teslim olabilen iletişim + aynı mesajın iş etkisini bir kez oluşturma. Ağ için sınırsız koşullarda “exactly once delivery” iddiası yoktur.

### 4.3. Önerilen zaman aşımı başlangıçları

| Parametre | Başlangıç değeri / kural |
|---|---|
| Heartbeat | 5 saniye |
| Offline kabulü | Son heartbeat'ten 15 saniye sonra |
| ACK bekleme | İlk denemede 1 saniye; artan bekleme, en fazla 8 saniye |
| Bir aktif bağlantıda yeniden deneme | En fazla 5 tekrar; sonra durum `DELIVERY_UNCONFIRMED`, sessiz silme yok |
| Mesajın ilk teslim ömrü | 180 saniye; süresi geçen yeni işlem başlatılmaz |
| Karar verilmeden önce müzakere süresi | 120 saniye |
| Henüz `ACCEPT` verilmemiş geçici tutma | En fazla 60 saniye |
| `ACCEPT` verilmiş hazırlık durumu | Nihai karar doğrulanmadan sırf yerel timer doldu diye serbest bırakılmaz |

Hub kalıcı teslim sorumluluğunu aldıysa gönderici aynı mesajı sonsuza kadar yeniden yollamaz; alıcıya teslim durumunu izler. Bağlantı geri geldiğinde bekleyen geçerli işler devam eder.

**Önemli ayrım:** Taşıma mesajının süresinin bitmesi, önceden kalıcılaşmış bir COMMIT kararını iptal etmez. Böyle bir durumda karar / durum senkronizasyonu yapılır. Güvenilir karar kaynağına ulaşılamıyorsa ajan `PENDING_RECOVERY` gösterir; yeni ve çakışan rezervasyonu kabul etmez.

Bunlar ölçüm öncesi başlangıç ayarlarıdır. Değiştirilecekse gerekçesi yazılır ve ilgili karşılaştırmalı deneyler aynı ayarlarla yeniden çalıştırılır.

---

## 5. M1 — Ajanlar konuşuyor

**Bu aşamanın sorusu:** “Üç ayrı ajan tanımladığımız dilde gerçekten haberleşebiliyor mu?”

**Çalışan çıktı:** Hub ve üç Node ajanı; komut satırından başlatılan, loglardan izlenen mesaj alışverişi.

**Henüz gerekmeyenler:** Ajan arama, gerçek toplantı algoritması, LLM, Google Calendar, mobil ekranlar. Mesaj dizisi bu aşamada açıkça **senaryo ile yönlendirilen protokol demosudur**; otomatik saat seçimi yapılmış gibi sunulmaz.

### MM-101 — Depo iskeletini ve çalıştırılabilir yerel ortamı kur

**GitHub başlığı:** `[M1][MM-101] Depo iskeletini ve çalıştırılabilir yerel ortamı kur`  
**Bağımlılıklar:** Yok  
**Etiketler:** `backend`, `agent`, `docs`

**Amaç / çıktı:** Bir geliştirici README'yi izleyerek hub ve A/B/C ajanlarını ayrı süreçler olarak başlatabilsin.

**Yapılacaklar:** Depo yapısını, TypeScript derleme / test düzenini, hub sağlık kontrolünü ve ajan başlatma parametrelerini oluştur. Ajan başına ayrı kalıcı durum dizini ayır. Mimari karar kaydında relay uyarlamasını, Node referans ajanını ve sonraki Dart ajanını ayır. Secret içermeyen örnek konfigürasyon ve ortam kontrol komutu ekle.

**Kabul kriterleri:**
- [ ] Temiz kurulumda hub ve üç farklı `agentId` ile üç ayrı süreç başlıyor; port / kimlik çakışmaları anlaşılır hata veriyor.
- [ ] Her ajan kendi SQLite durumunu kullanıyor; A'nın dosyası B tarafından yanlışlıkla paylaşılmıyor.
- [ ] Tek komutla başlangıç, kontrollü kapatma ve test verisini sıfırlama belgelenmiş.
- [ ] README gerekli araçları; mimari karar kaydı öneriden ayrılan noktaları ve telefon ajanı kapsamını açıklıyor.

**Kanıt:** Temiz kurulum terminal çıktısı, süreç / sağlık listesi ve `docs/decisions/001-runtime-and-routing.md`.

### MM-102 — Mesaj sözleşmesini ve doğrulayıcıyı oluştur

**GitHub başlığı:** `[M1][MM-102] Mesaj sözleşmesini ve doğrulayıcıyı oluştur`  
**Bağımlılıklar:** MM-101  
**Etiketler:** `protocol`, `test`

**Amaç / çıktı:** Node ve ileride Dart tarafından aynı şekilde yorumlanabilen sürümlü JSON sözleşmesi.

**Yapılacaklar:** Altı mesaj türünü, ortak zarfı, hata kodlarını ve ACK scope'larını tanımla. `PROPOSE` / `CONFIRM` alt aşamalarını şemada açıkça ayır. Sıra numarasını gönderen-alıcı-toplantı kapsamında tanımla; boşluk görülmesini otomatik veri kaybı veya otomatik kabul sayma. Her mesaj türü için geçerli / geçersiz fixture üret.

**Kabul kriterleri:**
- [ ] Altı türün her biri için en az bir geçerli ve iki geçersiz örnek otomatik testten geçiyor.
- [ ] Eksik alıcı, tanınmayan sürüm, hatalı zaman aralığı ve şema dışı payload domain işlemine girmeden reddediliyor.
- [ ] ACK'in `ackForMessageId` alanı zorunlu; `relay.persisted` ve `recipient.persisted` birbirinden ayrılıyor.
- [ ] Örnek mesajlar ve hata anlamları dil-bağımsız dosyalarda; yalnız TypeScript tipleriyle sınırlı değil.

**Kanıt:** JSON şemaları, fixture'lar, şema test raporu ve protokol README'si.

### MM-103 — Relay üzerinden üç ajan arasında mesaj taşı

**GitHub başlığı:** `[M1][MM-103] Relay üzerinden üç ajan arasında mesaj taşı`  
**Bağımlılıklar:** MM-101, MM-102  
**Etiketler:** `backend`, `agent`, `protocol`

**Amaç / çıktı:** A'nın B ve C'ye ayrı mesaj gönderebildiği, cevapların doğru ajana döndüğü bağlantı katmanı.

**Yapılacaklar:** Hub'da başlangıç için sabit ajan listeli yönlendirme oluştur. WebSocket açma / kapatma ve mesaj alma / gönderme adaptörünü domain mantığından ayır. Senaryo sürücüsünden REQUEST → PROPOSE → ACCEPT → CONFIRM akışı ile ayrı REJECT örneği üret. Bu aşamada yalnız yerel ortamda çalış.

**Kabul kriterleri:**
- [ ] A'nın B'ye gönderdiği mesaj C'nin inbox'ına düşmüyor; grup isteği ise B ve C için ayrı kimlikle iki mesaj üretiyor.
- [ ] Üç ajan kendi süreçlerinde gönderme / alma olaylarını gösteriyor; tek süreç içindeki fonksiyon çağrısı iletişim diye sayılmıyor.
- [ ] Bozuk JSON ve tanınmayan alıcı hub'ı çökertmiyor; testte açık hata gözlemleniyor.
- [ ] Altı mesaj türü taşıma katmanından geçebiliyor; toplantı içeriği relay tarafından yeniden hesaplanmıyor.

**Kanıt:** Üç ajan logu, yönlendirme testi ve temel mesaj akışının terminal kaydı.

### MM-104 — Kalıcı inbox/outbox, ACK ve tekrar işlemeyi önleme ekle

**GitHub başlığı:** `[M1][MM-104] Kalıcı inbox/outbox, ACK ve tekrar işlemeyi önleme ekle`  
**Bağımlılıklar:** MM-102, MM-103  
**Etiketler:** `agent`, `protocol`, `test`

**Amaç / çıktı:** ACK kaybolduğunda mesaj tekrar gitsin fakat aynı iş iki kez yapılmasın.

**Yapılacaklar:** Ajanın göndereceği mesajları outbox'a, gelenleri kalıcı inbox'a yaz. Inbox kaydı ile işleme kuyruğu kaydı aynı yerel işlem içinde oluşsun; ardından alıcı ACK göndersin. Tekrar deneme ve duplicate kontrolü ekle. Test için bir mesajı / ACK'i belirli noktada düşüren anahtar oluştur. Henüz kalıcı hub kuyruğu olmadığı için M1 alıcı ACK'ine dayanır.

**Kabul kriterleri:**
- [ ] İlk ACK bilerek düşürüldüğünde aynı `messageId` yeniden gidiyor; domain iş sayacı yalnız 1 artıyor.
- [ ] Aynı mesaj 10 kez geldiğinde 1 iş etkisi oluşuyor; aynı kimlikle farklı içerik güvenli şekilde reddediliyor.
- [ ] Inbox kaydı sonrası süreç öldürülüp açıldığında kaydedilmiş iş tamamlanıyor; ACK verilmiş iş kaybolmuyor.
- [ ] Tekrar sınırı aşılırsa açık `DELIVERY_UNCONFIRMED` durumu görülüyor; bu durum toplantı kabulü diye gösterilmiyor.

**Kanıt:** ACK-loss ve süreç yeniden başlatma testleri; mesaj sayısı / iş etkisi sayısını karşılaştıran rapor.

### MM-105 — M1 demo komutunu, log görünümünü ve geçiş testini hazırla

**GitHub başlığı:** `[M1][MM-105] M1 demo komutunu, log görünümünü ve geçiş testini hazırla`  
**Bağımlılıklar:** MM-101–104  
**Etiketler:** `test`, `docs`

**Amaç / çıktı:** Bir komutla çalışan protokol demosu ve yeşil / kırmızı sonucu açık M1 testi.

**Yapılacaklar:** Ortak log alanlarını uygula. `demo:m1` ve `test:gate:m1` komutlarını oluştur. Temiz veriyle normal, REJECT, bozuk mesaj ve düşürülen ACK senaryolarını çalıştır. Otomatik testleri CI'a ekle; testlerin gerçek ağ bağlantısı kullanan kısmını ayrı göster.

**Kabul kriterleri:**
- [ ] Normal senaryoda 100 benzersiz mesajın tamamı doğru alıcıya ulaşıyor ve toplam domain etkisi 100 oluyor.
- [ ] ACK-loss testi `message.retried` ve `message.duplicate` olaylarını görünür kılıyor.
- [ ] Bir assertion kasıtlı bozulduğunda gate komutu / CI başarısız çıkıyor.
- [ ] Demo çıktısında bunun script kontrollü protokol testi olduğu, henüz toplantı algoritması olmadığı açık.

**Kanıt:** `docs/evidence/m1/` içinde commit, test özeti ve temizlenmiş kısa log.

### M1 geçiş testi — Bunlar görülmeden M2 tamamlanmasına geçme

| Test | Uygulama | Gözlemlenecek sonuç |
|---|---|---|
| M1-T1 | Hub + A/B/C'yi başlat; senaryo isteği gönder | Üç ayrı ajan, doğru alıcı, REQUEST / PROPOSE / ACCEPT / CONFIRM akışı |
| M1-T2 | Ayrı bir senaryoda REJECT üret | Ret görünür; sahte başarı yok |
| M1-T3 | İlk alıcı ACK'ini düşür | Yeniden gönderim var, aynı işin ikinci etkisi yok |
| M1-T4 | Eksik alanlı mesaj gönder | Açık doğrulama hatası, süreçler ayakta |
| M1-T5 | Inbox'a yazdıktan sonra ajanı yeniden başlat | Kaydedilmiş iş kurtarılıyor |

- [ ] Beş senaryo geçiyor; normal 100 mesaj testi 100/100.
- [ ] `demo:m1` ikinci ekip üyesi tarafından README'den çalıştırıldı.
- [ ] Kanıtlar ve `m1-demo` kod etiketi aynı commit'i gösteriyor.

**Aşama sonunda söylenecek cümle:** “Üç ajan, kendi protokolümüzle konuşuyor; ACK kaybında tekrar gönderim ve tek işleme çalışıyor.”

---

## 6. M2 — Ajanlar bulunuyor ve çevrimdışı mesajlar bekliyor

**Bu aşamanın sorusu:** “Ajanın kim olduğunu ve nereden ulaşılacağını biliyor muyuz; kapalıysa mesajı kaybetmeden bekletebiliyor muyuz?”

**Çalışan çıktı:** Directory, Registrar, kimlik doğrulamalı bağlantılar ve hub yeniden başlatılsa da kalan posta kutusu.

**Henüz gerekmeyenler:** Anlamsal arama, gerçek takvim, otomatik ortak saat hesabı. Directory bu aşamada kimlik / isim / yetenek etiketiyle deterministik arama yapar.

### MM-201 — Agent Directory, profil ve bulunabilirlik kurallarını oluştur

**GitHub başlığı:** `[M2][MM-201] Agent Directory, profil ve bulunabilirlik kurallarını oluştur`  
**Bağımlılıklar:** MM-101, MM-102  
**Etiketler:** `backend`, `security`

**Amaç / çıktı:** İsim / kimlik / yetenek etiketiyle aranan ajan yalnız yetkili kullanıcıya bulunabilsin.

**Yapılacaklar:** Profilde `agentId`, görünen ad, yetenek etiketleri, sahibi ve görünürlük kuralını tut. Başlangıç görünürlükleri private / friends / public olsun. Normalleştirilmiş tam eşleşme ve arkadaş erişimini ekle. 30 saniyelik sonuç önbelleğini ve değişiklikte invalidation mekanizmasını uygula. Gerçek oturum kimliği MM-202/204 ile bağlanacak.

**Kabul kriterleri:**
- [ ] Aynı isimli iki profil tek kişiymiş gibi birleştirilmiyor; sabit `agentId` ayrımı korunuyor.
- [ ] Private ajan başka hesaba arama sonucunda veya ID ile doğrudan sorguda sızmıyor.
- [ ] Yetenek etiketi araması beklenen görünür ajanları getiriyor; bunun henüz embedding araması olmadığı belirtiliyor.
- [ ] Önbellek doluyken görünürlük private yapılınca sonraki yetkisiz sorgu sonucu görmüyor; TTL dolması beklenmiyor.

**Kanıt:** Yetki matrisi, önbellek testi ve örnek Directory arama çıktısı.

### MM-202 — Kimlik doğrulamalı Registrar ve bağlantı yaşam döngüsü ekle

**GitHub başlığı:** `[M2][MM-202] Kimlik doğrulamalı Registrar ve bağlantı yaşam döngüsü ekle`  
**Bağımlılıklar:** MM-201, MM-103  
**Etiketler:** `backend`, `protocol`, `security`

**Amaç / çıktı:** Sabit ajan kimliği doğru aktif bağlantıya bağlansın; eski oturum yeni oturumu bozamamasın.

**Yapılacaklar:** Oturum token'ını kullanıcı / ajan kimliğiyle ilişkilendir. REGISTER, heartbeat, `lastSeen`, bağlantı durumu ve session generation kaydet. Bunları domain mesajlarından ayrı kontrol işlemleri olarak tanımla. Aynı ajan ikinci kez bağlanınca eski oturumu kapat veya etkisizleştir; yeni oturumu tek yetkili oturum yap.

**Kabul kriterleri:**
- [ ] Ajan bağlandığında online, heartbeat kesildikten 15 saniye sonra offline görünüyor.
- [ ] A'nın token'ıyla B olarak REGISTER veya `fromAgentId=B` mesajı gönderme reddediliyor.
- [ ] Aynı `agentId` yeniden bağlandığında mesaj yalnız yeni session'a gidiyor; eski close olayı yeni kaydı silmiyor.
- [ ] Uç / bağlantı bilgisi değişirken `agentId` değişmiyor; olay logundan geçiş izleniyor.

**Kanıt:** Heartbeat ve session değişimi testleri; registrar durum çıktısı.

### MM-203 — Kalıcı çevrimdışı posta kutusunu ve teslim durumlarını uygula

**GitHub başlığı:** `[M2][MM-203] Kalıcı çevrimdışı posta kutusunu ve teslim durumlarını uygula`  
**Bağımlılıklar:** MM-104, MM-202  
**Etiketler:** `backend`, `protocol`, `test`

**Amaç / çıktı:** Kapalı ajana gönderilen mesaj DB'de beklesin, yeniden bağlantıda güvenli şekilde teslim edilsin.

**Yapılacaklar:** Alıcı bazlı kuyruk, `QUEUED / SENT / DELIVERED / EXPIRED` durumları ve benzersiz mesaj anahtarı ekle. DB commit sonrasında `relay.persisted` ACK üret. Alıcı inbox ACK'i gelmeden DELIVERED yazma. Süreli worker sahiplenme / yeniden deneme ile sunucu restart sonrası takılı işleri kurtar. Kuyruk durumunu CLI / API'den okunabilir yap.

**Kabul kriterleri:**
- [ ] C offline iken mesaj QUEUED; alıcı teslimi henüz başarılı görünmüyor.
- [ ] Hub yeniden başlatıldığında kuyruğun içeriği ve mesaj kimliği korunuyor.
- [ ] C geri geldiğinde geçerli mesaj bir iş etkisi üretiyor; alıcı ACK'i sonrası DELIVERED oluyor.
- [ ] Süresi dolmuş, henüz kabul edilmemiş mesaj yeni iş başlatmıyor; EXPIRED sonucu göndericiye gösteriliyor.
- [ ] Aynı mesajın hub'a 10 kez gönderilmesi 10 ayrı kuyruk kaydı oluşturmuyor.

**Kanıt:** Kuyruk durum geçişleri, DB restart testi ve sentetik saatle expiry testi.

### MM-204 — TLS, mesaj MAC'i ve tekrar oynatma koruması ekle

**GitHub başlığı:** `[M2][MM-204] TLS, mesaj MAC'i ve tekrar oynatma koruması ekle`  
**Bağımlılıklar:** MM-102, MM-202, MM-203  
**Etiketler:** `security`, `protocol`, `test`

**Amaç / çıktı:** Yanlış kimlik, değiştirilmiş içerik veya eski mesaj geçerli yeni işlem gibi kabul edilmesin.

**Yapılacaklar:** WSS ve sertifika doğrulamasını etkinleştir. Mesajın kimlik, hedef, tip, zaman ve payload alanlarını kapsayan kanonik imzalama sözleşmesi oluştur; standart kütüphanelerle HMAC uygula. Demo için ajan çifti bazında ayrı anahtarlar üret, repo dışında sağla. Nonce / mesaj hash geçmişini kabul edilen mesaj ömrü boyunca kalıcı tut. Tekrar iletim ile replay saldırısını ayır.

**Kabul kriterleri:**
- [ ] Geçersiz / süresi dolmuş oturum ve güvenilmeyen TLS sertifikası reddediliyor; doğrulamayı kapatan genel ayar kullanılmıyor.
- [ ] Payload veya alıcı alanı değiştirilen mesaj MAC kontrolünden geçmiyor.
- [ ] Aynı nonce ile farklı yeni mesaj reddediliyor; meşru aynı mesaj tekrarı ise ACK alıyor fakat yeniden işlenmiyor.
- [ ] Ajan restart sonrası eski kabul edilmiş mesaj yeniden iş etkisi üretmiyor.
- [ ] Anahtarlar, token'lar ve gerçek kişisel veri loglarda / repoda yok; demo anahtar dağıtımının üretim seviyesi bir anahtar yönetimi çözümü olmadığı yazılı.

**Kanıt:** Pozitif / negatif güvenlik testleri, Node–Dart için ortak MAC test vektörleri ve güven sınırları notu.

### MM-205 — Bulma → çevrimdışı bekletme → yeniden teslim demosunu birleştir

**GitHub başlığı:** `[M2][MM-205] Bulma → çevrimdışı bekletme → yeniden teslim demosunu birleştir`  
**Bağımlılıklar:** MM-201–204  
**Etiketler:** `test`, `docs`

**Amaç / çıktı:** M2'nin parçaları tek senaryoda, kullanıcıya görünen durumlarla çalışsın.

**Yapılacaklar:** `demo:m2` içinde A, B/C'yi Directory'den bulsun; C'yi kapat, mesaj gönder, hub'ı yeniden başlat, C'yi aç. Kayıt / kuyruk / teslim durumlarını aynı runId altında göster. Görünürlük ve oturum sahteciliği negatif testlerini gate'e ekle.

**Kabul kriterleri:**
- [ ] A, sabit kodlanmış B/C bağlantı adresi kullanmadan Directory ve Registrar üzerinden iletişim başlatıyor.
- [ ] C kapalıyken B teslim alıyor; C için durum bekliyor; tüm grup teslim aldı denmiyor.
- [ ] C geri gelince test ortamında en geç 10 saniyede bekleyen mesaj alıcı inbox'ına ulaşıyor ve kuyruk tamamlanıyor.
- [ ] 10 tekrarın her birinde restart sonrası mesaj korunuyor ve alıcı iş etkisi 1 oluyor.

**Kanıt:** `docs/evidence/m2/` içinde 10 koşunun özeti, kısa demo ve güvenlik test sonuçları.

### M2 geçiş testi — Bunlar görülmeden M3 tamamlanmasına geçme

| Test | Uygulama | Gözlemlenecek sonuç |
|---|---|---|
| M2-T1 | A, B/C'yi isimden bulur | Doğru ajan kimlikleri; yetkisiz profil görünmez |
| M2-T2 | C'yi kapat, A'dan B/C'ye gönder | B teslim alır; C mesajı kalıcı QUEUED |
| M2-T3 | C kapalıyken hub'ı yeniden başlat | Mesaj hâlâ kuyrukta |
| M2-T4 | C'yi tekrar başlat | En geç 10 saniyede teslim; tek iş etkisi; DELIVERED |
| M2-T5 | Eski session ve değiştirilmiş MAC kullan | Reddedilir; yeni session çalışmaya devam eder |
| M2-T6 | Henüz teslim edilmemiş mesajın süresini geçir | EXPIRED görünür; yeni domain işlemi yok |

- [ ] Entegre çevrimdışı / restart senaryosu 10/10 geçiyor.
- [ ] Yetkisiz keşif ve sahte gönderici testleri geçiyor.
- [ ] M1 regresyonu WSS kullanılan ortamda da geçiyor.
- [ ] `m2-demo` etiketi ve yeniden çalıştırma yönergesi hazır.

**Aşama sonunda söylenecek cümle:** “Ajanları bulabiliyoruz; kapalı ajanın mesajı sunucu yeniden başlasa bile kaybolmuyor.”

---

## 7. M3 — Ajanlar gerçekten toplantı ayarlıyor

**Bu aşamanın sorusu:** “Mesajlaşma, takvim verisine dayalı ortak bir karara dönüşüyor mu?”

**Çalışan çıktı:** Sahte takvimlerle çalışan otomatik ortak saat seçimi, onay ve tekil takvim kaydı.

**Henüz gerekmeyenler:** LLM, gerçek Google hesabı ve Flutter. Bu aşamanın sonucu sabit yazılmış “14.00 seçildi” çıktısı değil, girdilerden hesaplanan sonuç olmalıdır.

### Sabit doğrulama örneği

Tarih: **10 Kasım 2026**, saat dilimi: **Europe/Istanbul**. Süre: **60 dakika**, aday başlangıç aralığı: **30 dakika**.

| Ajan | Müsait aralıklar |
|---|---|
| A | 10.00–12.00 ve 14.00–16.00 |
| B | 11.00–13.00 ve 14.00–15.00 |
| C | 10.30–12.00 ve 14.00–16.00 |

Ortak adaylar: **11.00–12.00** ve **14.00–15.00**.

| Aday | A puanı | B puanı | C puanı | Toplam |
|---|---:|---:|---:|---:|
| 11.00–12.00 | 40 | 80 | 60 | 180 |
| 14.00–15.00 | 90 | 50 | 80 | 220 |

**Beklenen seçim: 14.00–15.00.** Bu tablo sentetik fixture tanımıdır; kullanıcının gerçek takvimi veya ölçülmüş sonuç değildir. Sağlayıcı fixture'ı bu müsaitlikleri verecek busy aralıklarını tutabilir.

### MM-301 — Takvim adaptörü, tercihler ve deterministik fixture'lar oluştur

**GitHub başlığı:** `[M3][MM-301] Takvim adaptörü, tercihler ve deterministik fixture'lar oluştur`  
**Bağımlılıklar:** MM-102, MM-104  
**Etiketler:** `agent`, `calendar`, `test`

**Amaç / çıktı:** Takvim sağlayıcısı sonradan değişse de aynı zaman / rezervasyon sözleşmesi kullanılsın.

**Yapılacaklar:** `getBusy`, geçici rezervasyon kontrolü, `ensureEvent` ve durum sorgusu için adaptör tanımla. Sahte sağlayıcıyı ajan başına ayrı kalıcı veriye bağla. Müsaitlik, çalışma saatleri ve 0–100 tercih puanlarını tanımla. Normal, ortak saat yok, eşit puan, farklı saat dilimi ve mevcut etkinlikle çakışma fixture'ları ekle.

**Kabul kriterleri:**
- [ ] Yukarıdaki örnek fixture beklenen iki ortak adayı üretecek veriyi sağlıyor.
- [ ] Aralıklar `[başlangıç, bitiş)` olarak işleniyor; 11.00'de biten etkinlik 11.00'de başlayan slotu gereksiz yere kapatmıyor.
- [ ] Aynı mutlak zaman farklı saat dilimi gösterimlerinde aynı sonuç veriyor; gece yarısını aşan örnek test ediliyor.
- [ ] Bir ajanın mevcut etkinlik başlık / açıklama alanları diğer ajana gönderilecek veri yapısına taşınmıyor.

**Kanıt:** Fixture dosyaları, sağlayıcı sözleşmesi ve zaman / gizlilik unit testleri.

### MM-302 — Ortak slot bulma ve tercih puanlama algoritmasını yaz

**GitHub başlığı:** `[M3][MM-302] Ortak slot bulma ve tercih puanlama algoritmasını yaz`  
**Bağımlılıklar:** MM-301  
**Etiketler:** `agent`, `test`

**Amaç / çıktı:** Başlatan ajan, herkesin uygun olduğu adaylardan en iyi olanı hesaplasın.

**Yapılacaklar:** Süre, tarih aralığı, çalışma saatleri ve slot adımıyla aday üret. Her katılımcının uygunluk / puan cevabını birleştir. Uygun olmayan adayı toplam puanı yüksek diye seçme. Eşit toplamda önce erken başlangıç, sonra kararlı slot kimliği kuralını uygula. Neden seçildiğini kişisel ayrıntı sızdırmadan açıkla.

**Kabul kriterleri:**
- [ ] Temel fixture'da 220 puanlı 14.00–15.00 seçiliyor; 11.00–12.00 neden ikinci olduğu görülebiliyor.
- [ ] Bir katılımcının verisi eksikse “herkes için uygun” sonucu üretilmiyor.
- [ ] Eşit puanlı girdiler, cevapların geliş sırası değişse de aynı slotu seçiyor.
- [ ] Ortak slot yoksa `NO_COMMON_SLOT` çıkıyor; sistem kendiliğinden süreyi kısaltmıyor veya tarih aralığını genişletmiyor.

**Kanıt:** Girdi → adaylar → puanlar → seçilen slot çıktısı ve deterministik algoritma testleri.

### MM-303 — Müzakere durum makinesini ve geçici rezervasyonu uygula

**GitHub başlığı:** `[M3][MM-303] Müzakere durum makinesini ve geçici rezervasyonu uygula`  
**Bağımlılıklar:** MM-205, MM-302  
**Etiketler:** `agent`, `protocol`, `test`

**Amaç / çıktı:** Ortak saat yalnız bütün katılımcılar gerçekten kabul ettiğinde kesin karara dönüşsün.

**Yapılacaklar:** Akışı REQUEST → PROPOSE(candidates) → PROPOSE(selection) → ACCEPT/REJECT → CONFIRM(decision) → CONFIRM(applied) olarak tanımla. Alt aşamaları payload'da ayır. Başlatan ajan da katılımcı kabulüne dâhil olsun. Her turu `roundId` ve karar sürümüyle sınırla. Başlatanın kalıcı karar defterine tek COMMIT veya ABORT yaz. Yerel rezervasyon kontrolü ile kaydı atomik yap.

**Kabul kriterleri:**
- [ ] Bir kişi ACCEPT vermeden COMMIT kararı ve takvim yazımı başlamıyor.
- [ ] Aynı ajanı aynı saat için isteyen iki paralel toplantıda yerel rezervasyon nedeniyle ikisi birden kabul edilmiyor.
- [ ] Eski turdan ACCEPT / CONFIRM mesajı yeni turun kararını değiştirmiyor.
- [ ] Ret veya karar öncesi timeout'ta ABORT kaydı oluşuyor; geçici tutmalar güvenli şekilde bırakılıyor.
- [ ] ACCEPT vermiş ajan karar kaynağına ulaşamıyorsa `PENDING_RECOVERY` gösteriyor; beklemeyi başarı gibi göstermiyor ve slotu körlemesine serbest bırakmıyor.

**Kanıt:** Durum geçiş tablosu, paralel toplantı testi ve her mesajın hangi geçişi tetiklediği logu.

### MM-304 — Takvim yazımını tekilleştir ve yarım kalan kararı kurtar

**GitHub başlığı:** `[M3][MM-304] Takvim yazımını tekilleştir ve yarım kalan kararı kurtar`  
**Bağımlılıklar:** MM-301, MM-303  
**Etiketler:** `agent`, `calendar`, `test`

**Amaç / çıktı:** Tekrar gönderilen onay veya yeniden başlayan süreç ikinci bir toplantı oluşturmadan işi tamamlasın.

**Yapılacaklar:** `meetingId + agentId` bazlı kalıcı iş / etkinlik eşlemesi tut. COMMIT sonrası takvim yazma ve sonucu bildirme işlerini yeniden yürütülebilir yap. Takvime yazıldıktan hemen sonra süreç ölmesi gibi belirsiz sonuçları sorgulayarak uzlaştır. Bütün katılımcıların yazım sonucu gelene kadar toplantıyı COMMITTING / COMMIT_PENDING göster.

**Kabul kriterleri:**
- [ ] Aynı CONFIRM 10 kez gelince her sahte takvimde yalnız bir etkinlik oluşuyor.
- [ ] Koordinatör COMMIT'i yazdıktan sonra kapanıp açılınca aynı karar dağıtılıyor; yeni karar veya yeni toplantı kimliği üretilmiyor.
- [ ] Bir katılımcının yazımı başarısızken genel durum CONFIRMED olmuyor; hangi katılımcının beklediği görülüyor.
- [ ] Kalıcı COMMIT'ten sonra taşıma mesajı süresi dolsa da yeni durum senkronizasyonuyla iş tamamlanabiliyor.
- [ ] Belirsiz durum / kalıcı sağlayıcı hatası açıkça raporlanıyor; bütün takvimlerde tek transaction varmış gibi atomiklik iddia edilmiyor.

**Kanıt:** Duplicate-confirm, commit-sonrası-restart ve yarım yazım kurtarma testleri.

### MM-305 — Üç ajanlı toplantı demosunu ve başarısızlık senaryolarını tamamla

**GitHub başlığı:** `[M3][MM-305] Üç ajanlı toplantı demosunu ve başarısızlık senaryolarını tamamla`  
**Bağımlılıklar:** MM-301–304  
**Etiketler:** `test`, `docs`

**Amaç / çıktı:** Gerçek seçim algoritması ve protokolün birlikte çalıştığı, doğrulanabilir toplantı demosu.

**Yapılacaklar:** `demo:m3` ve `test:gate:m3` oluştur. Başlatanın komutundan üç takvimdeki sonuca kadar izi göster. Ortak saat yok, açık ret, zaman aşımı, paralel istek ve tekrar onay senaryolarını ekle. Sentetik takvimdeki özel başlık canary'sinin tel / hub loglarına çıkmadığını denetle.

**Kabul kriterleri:**
- [ ] Normal fixture'da üç ajan aynı 14.00–15.00 toplantısını birer kez oluşturuyor.
- [ ] Normal senaryo 20 temiz çalıştırmanın 20'sinde aynı sonucu veriyor.
- [ ] Ortak saat yok / ret / karar öncesi timeout senaryolarında yeni takvim etkinliği sayısı 0.
- [ ] Gizlilik testinde mevcut etkinlik başlığı / açıklaması canary'si ajanlar arası payload ve hub loglarında bulunmuyor.
- [ ] Demo gerçek algoritmayı çalıştırıyor; beklenen sonucu test sürücüsü payload'a hazır final cevap olarak yerleştirmiyor.

**Kanıt:** `docs/evidence/m3/` içinde 20 koşu özeti, takvim kayıt sayıları ve başarısızlık örnekleri.

### M3 geçiş testi — Bunlar görülmeden M4 ölçümlerini sonuç sayma

| Test | Uygulama | Gözlemlenecek sonuç |
|---|---|---|
| M3-T1 | Temel üç ajan fixture'ını çalıştır | 14.00–15.00, toplam puan 220, her takvimde tek kayıt |
| M3-T2 | Ortak müsaitliği kaldır | NO_COMMON_SLOT; hiçbir takvimde yeni kayıt yok |
| M3-T3 | Bir katılımcıyı reddettir | REJECTED / ABORT; takvim kaydı yok |
| M3-T4 | Aynı slot için eşzamanlı iki toplantı başlat | Aynı ajanın aynı slotta iki ayrı toplantıya onayı yok |
| M3-T5 | CONFIRM'i tekrar et; koordinatörü yeniden başlat | Aynı karar; mükerrer kayıt yok |
| M3-T6 | Bir takvim yazımını geçici başarısız yap | COMMIT_PENDING görünür; düzeldikten sonra tek kayıtla tamamlanır |
| M3-T7 | Saat dilimi / sınır / gizli başlık testlerini çalıştır | Zamanlar doğru; özel etkinlik içeriği paylaşılmaz |

- [ ] Normal senaryo 20/20; bütün negatif / kurtarma testleri başarılı.
- [ ] CONFIRMED, bütün katılımcıların takvim yazım sonucu alınmadan görünmüyor.
- [ ] M1–M2 regresyonları geçiyor.
- [ ] `m3-demo` etiketi, fixture sürümü ve demo kaydı hazır.

**Aşama sonunda söylenecek cümle:** “Ajanlarımız, takvimlerini tamamen paylaşmadan ortak saat seçiyor ve aynı toplantıyı birer kez oluşturuyor.”

---

## 8. M4 — Sistem kötü ağ koşullarında sınanıyor

**Bu aşamanın sorusu:** “Aynı çalışan sistem, gecikme ve kopma altında ne yapıyor; bunu ölçerek gösterebiliyor muyuz?”

**Çalışan çıktı:** Dışa aktarılabilir Air topolojisi, tekrar kurulabilir ajan dağıtımı, kontrollü ağ profilleri ve ham sonuçlardan üretilmiş deney raporu.

**Araç notu:** NVIDIA DSX Air dokümantasyonu özel topolojiler / Linux sunucu düğümleri ve NGC tabanlı erişimi tarif ediyor. Deneme erişimi otomatik garanti değildir. [W1][W2] Air, bu planın seçtiği deney hedefidir; ders yönergesinin zorunlu kıldığı araç veya hocanın adını kesin doğruladığımız ürün diye yazılmamalıdır.

**Deney sınırı:** Burada uygulamanın gecikme / kayıp / kopma karşısındaki davranışı emüle edilir. Bir Air sanal ağı üzerinde test yapmak, gerçek 5G radyo kanalının veya baz istasyonu geçişinin fiziksel simülasyonu yapılmış olduğu anlamına gelmez.

### Deney topolojisi

```text
Agent A VM ----\
Agent B VM -----+---- veri ağı / switch ---- Hub VM
Agent C VM ----/

Yönetim ağı: SSH / kurulum / log toplama
Veri ağı: WSS ajan mesajları ve deneyde bozulan bağlantılar
```

Ajan mesajları yanlışlıkla ayrı yönetim bağlantısından dolaşırsa NetEm deneyi geçersiz sayılır.

### MM-401 — Air erişimini ve Linux test yeteneklerini erken doğrula

**GitHub başlığı:** `[M4][MM-401] Air erişimini ve Linux test yeteneklerini erken doğrula`  
**Bağımlılıklar:** Başlamak için yok; M1 ile paralel  
**Etiketler:** `network-lab`, `docs`

**Amaç / çıktı:** Deney ortamının gerçekten erişilebilir olduğunu geliştirme başında öğren.

**Yapılacaklar:** NGC / Air hesabını ve kurum erişimini kontrol et. Küçük bir topolojiyle bir Linux düğümü aç; oturum, dosya aktarımı, veri arayüzü, gereken yazılımın kurulumu ve NetEm yeteneğini dene. Erişim / kota / imaj / yetki hatalarını kaydet. Sunum için servis dışı kalma planını yaz.

**Kabul kriterleri:**
- [ ] En az bir Linux düğümünde uygulama çalıştırılabiliyor ve veri arayüzü tanımlanmış.
- [ ] `tc` / NetEm işlevi ve gerekli yetki mevcut veya eksiklik açıkça engel olarak kayıtlı.
- [ ] Başka ekip üyesi kurulum adımlarını izleyebiliyor; kişisel token paylaşımı gerekmiyor.
- [ ] Air erişilemiyorsa issue BLOCKED; yerel Linux / Linux VM alternatifi belgelenmiş fakat Air üzerinde çalıştırılmış gibi işaretlenmemiş.

**Kanıt:** Erişim kontrol listesi, küçük smoke-test logu ve engel / alternatif kararı. [W1][W2][W3]

### MM-402 — Hub ve üç ajanı tekrar kurulabilir Air topolojisine dağıt

**GitHub başlığı:** `[M4][MM-402] Hub ve üç ajanı tekrar kurulabilir Air topolojisine dağıt`  
**Bağımlılıklar:** MM-401, M3 geçişi  
**Etiketler:** `network-lab`, `backend`, `docs`

**Amaç / çıktı:** Yereldeki aynı kod sürümü dört ayrı Linux düğümünde çalışsın.

**Yapılacaklar:** Hub, A/B/C ve switch içeren topolojiyi dosyalaştır. Kurulum / başlatma betikleri, persistent state dizinleri, güvenli test kimlikleri ve yapılandırılmış log toplama ekle. WSS sertifikalarını kullanılan adreslerle uyumlu yap. Uygulama yolunu yönetim ağından ayır; kontrollü data-link kesintisiyle doğrula.

**Kabul kriterleri:**
- [ ] Temiz topolojide aynı commit dağıtılıyor; manuel ve kayda geçirilmemiş dosya düzenlemesi gerekmiyor.
- [ ] Bozulmamış Air veri ağında M3 normal senaryosu çalışıyor.
- [ ] Veri bağlantısı kesilince ajan iletişimi etkileniyor; yönetim erişimi log toplamak için kullanılabiliyor.
- [ ] Topoloji export'u, düğüm kaynakları, işletim sistemi / runtime sürümleri ve uygulama konfigürasyonu kayıtlı.

**Kanıt:** `infra/air/` topoloji / kurulum dosyaları ve uygulamanın veri yolunu kanıtlayan test.

### MM-403 — Ağ profilleri ve uygulama seviyesinde hata enjeksiyonu ekle

**GitHub başlığı:** `[M4][MM-403] Ağ profilleri ve uygulama seviyesinde hata enjeksiyonu ekle`  
**Bağımlılıklar:** MM-402, MM-104  
**Etiketler:** `network-lab`, `protocol`, `test`

**Amaç / çıktı:** Her koşuda hangi arızanın nerede uygulandığı belli olsun; deney sonrası ortam temizlenebilsin.

**Yapılacaklar:** `lab:apply` / `lab:reset` geliştir. NetEm ile gecikme / jitter / paket kaybı; süreç veya bağlantı kontrolüyle offline durumu oluştur. Ayrı bir test adaptöründe ilk REQUEST'i düşürme, ilk recipient ACK'ini düşürme, CONFIRM'i çoğaltma ve eski tur mesajı verme ekle. Hata anahtarları normal kullanımda kapalı olsun.

**Kabul kriterleri:**
- [ ] Gecikme / kayıp profili yalnız belgelenmiş veri arayüzlerine uygulanıyor; ayar ve sayaç çıktısı kanıta ekleniyor.
- [ ] Ölçülen gecikmenin yönü açık: tek link / tek yön ayarı ile uçtan uca toplam süre birbirine karıştırılmıyor.
- [ ] NetEm paket kaybı ile JSON uygulama mesajı kaybı ayrı profileId'lere sahip.
- [ ] Profil kaldırılınca kuyruk disiplini / bağlantı ayarı başlangıç durumuna dönüyor; senaryolar birbirini kirletmiyor.
- [ ] TLS açıkken dahi uygulama adaptörüyle mantıksal ACK / mesaj düşürme testi yapılabiliyor; şifreli paket payload'ını okuyarak değiştirme varsayılmıyor.

**Kanıt:** Profil konfigürasyonları, uygulama / temizleme logu ve her hata için kısa smoke testi. [W3]

### MM-404 — Ağ deneylerini otomatikleştir ve metrik raporu üret

**GitHub başlığı:** `[M4][MM-404] Ağ deneylerini otomatikleştir ve metrik raporu üret`  
**Bağımlılıklar:** MM-403  
**Etiketler:** `network-lab`, `test`

**Amaç / çıktı:** Tek seferlik demo yerine tekrar sayısı ve hata nedenleri görülen karşılaştırma.

**Yapılacaklar:** Alttaki deney matrisini `bench:network` ile çalıştır. Koşu başına başarı, son durum, koordinatörün yerel monoton saatiyle tamamlanma süresi, uygulama mesaj / retry / duplicate sayıları, kuyruk beklemesi ve takvim kayıt sayısını kaydet. CSV / JSON sonuçlarından özet üret; farklı VM saatlerini doğrudan çıkararak süre hesaplama.

**Kabul kriterleri:**
- [ ] Her koşu commit, profileId, runId, veri seti, konfigürasyon ve varsa desteklenen random seed bilgisi taşıyor.
- [ ] Başarısız ve timeout olan koşular da toplam sayıya dâhil; yalnız başarılı örnekler seçilmiyor.
- [ ] Başarılı koşuların medyan / P95 süreleri ayrı, başarı oranı ve timeout sayısı ayrı gösteriliyor.
- [ ] Gerçek zaman eşikleri aşılırsa rapor bunu FAIL olarak yazıyor; sonuçları geçirebilmek için sonradan sessiz eşik değiştirme yok.
- [ ] Kalıcı arızada yanlış CONFIRMED durumu veya mükerrer takvim kaydı görülürse kritik hata kabul ediliyor.

**Kanıt:** Ham `runs.jsonl` / `results.csv`, yapılandırma dosyası ve ham veriden yeniden üretilebilen özet.

### MM-405 — Ağ demosunu, ölçüm yorumunu ve sunum kanıtını tamamla

**GitHub başlığı:** `[M4][MM-405] Ağ demosunu, ölçüm yorumunu ve sunum kanıtını tamamla`  
**Bağımlılıklar:** MM-402–404  
**Etiketler:** `network-lab`, `docs`, `test`

**Amaç / çıktı:** Sunumda hem çalışan davranış hem de onun ölçüm kanıtı gösterilebilsin.

**Yapılacaklar:** `demo:m4` ile normal → C offline → kuyruk → C dönüş → toplantı akışını göster. Bir başka kısa akışta ACK kaybı / duplicate etkisini göster. Başarı ve başarısızlık tablolarını gerçek deneyden doldur. TCP'nin taşıma katkısı ile uygulama seviyesindeki kuyruk / idempotency katkısını ayrı açıkla.

**Kabul kriterleri:**
- [ ] Sunumdaki her sayının hangi ham koşulardan üretildiği bulunabiliyor.
- [ ] Canlı demoya ek olarak aynı sürümden alınmış kısa kayıt var; kayıt canlı ölçümmüş gibi sunulmuyor.
- [ ] Rapor deney ortamının gerçek mobil radyo ağı olmadığını, kullanılan hata modelini ve sınırlı örnek sayısını açıklıyor.
- [ ] Air çalışması yapılamadıysa 'yerel Linux sonucu' olarak etiketleniyor; M4-Air geçişi açık veya öğretim elemanı tarafından kabul edilmiş alternatif olarak belgeleniyor.

**Kanıt:** `docs/evidence/m4/`, deney raporu, kısa kayıt ve `m4-demo` kod etiketi.

### M4 deney matrisi ve önerilen geçiş eşikleri

**Bunlar başlangıç kabul hedefleridir; gerçekleşmiş ölçüm değildir.** İlk smoke testten sonra değişiklik gerekirse ölçüm serisi başlamadan gerekçe / yeni eşikler kaydedilmeli. Karşılaştırma serileri aynı kod ve ayarlarla çalıştırılmalıdır.

Varsayılan katılımcı sayısı 3; her koşuda yeni toplantı ve temiz fixture kullanılır. Düşürülen uygulama mesajları, tekrar iletim yolunu denemek için seçilmiş ilk denemelerde düşürülür; bütün tekrarlar sonsuza kadar düşürülmez.

| Profil | Uygulanan koşul | Tekrar | Geçiş hedefi |
|---|---|---:|---|
| N0 | Yapay bozulma yok | 20 | 20/20 doğru toplantı; her koşu ≤10 sn |
| N1 | Her uygulama düğümünün veri çıkışına 150 ms gecikme | 20 | 20/20 doğru toplantı; her koşu ≤30 sn |
| N2 | Aynı çıkışlarda 150 ms gecikme + 20 ms jitter + %5 paket kaybı | 20 | En az 19/20 toplantı ≤60 sn; yanlış karar / mükerrer kayıt 0 |
| N3 | C, istek başlamadan kapalı; 30 sn sonra açılır | 20 | 20/20; dönüşten itibaren ≤30 sn içinde tamamlanma |
| N4 | C'ye giden ilk uygulama REQUEST'i ve ayrı koşuda ilk recipient ACK'i düşürülür | Her alt test 10 | 10/10; tekrar görünür; aynı işin ikinci etkisi 0 |
| N5 | Her CONFIRM kontrollü olarak 3 kopya teslim edilir | 10 | 10/10; ajan başına tek takvim kaydı |
| N6 | C ilk ACCEPT öncesinden itibaren sürekli kapalı kalır | 3 | 120 sn karar öncesi deadline + en fazla 5 sn işleme payında açık başarısızlık; yeni etkinlik 0 |
| N7 | Hub yeniden başlar; ayrı koşuda koordinatör COMMIT sonrası yeniden başlar | Her alt test 5 | 5/5; dönüşten itibaren ≤30 sn içinde aynı karara yakınsama; mükerrer kayıt 0 |
| N8 | Katılımcı ACCEPT sonrası karar kaynağından kopar | 3 | Kopukken PENDING_RECOVERY ve rezervasyon korunur; bağlantı düzelince aynı karara yakınsar |

**Gecikme yorumu:** N1'de A → hub → B mesajı iki geciktirilen çıkıştan geçer. Bu yüzden “150 ms profil” ile uygulamanın toplam gecikmesi aynı şey değildir. N2'de %5 de her uygulanan çıkışın ayarıdır; uçtan uca ölçülmüş tek bir kayıp yüzdesi değildir.

**Ölçümler:** Başarı oranı, toplam / başarılı / timeout koşu sayısı, başarılı koşuların medyan ve P95 süresi, uygulama retry / duplicate sayısı, son takvim kayıt sayısı. TCP yeniden iletim sayısı ayrıca ölçülmediyse onun hakkında sayı uydurulmaz.

**İsteğe bağlı karşılaştırma:** Aynı hata profili altında uygulama yeniden gönderimi veya kalıcı kuyruk kapatılmış deney modu çalıştırılabilir. Bu zorunlu geçiş kriteri değildir; üretim ayarıyla karıştırılmamalıdır.

### M4 geçiş kapısı

- [ ] N0–N8 çalıştırıldı; her profil için ham veri ve PASS / FAIL sonucu var.
- [ ] Yanlış başarı, onaysız takvim yazımı, mükerrer kayıt ve özel takvim içeriği sızıntısı yok.
- [ ] Veri ağı / yönetim ağı ayrımı doğrulandı; NetEm ayarları deney sonunda temizleniyor.
- [ ] M1–M3 regresyonu geçiyor.
- [ ] Air kanıtı mevcut; değilse M4-Air açık ve alternatifin kabul durumu belgeli.
- [ ] `m4-demo` etiketi ile raporun commit'i aynı.

**Aşama sonunda söylenecek cümle:** “Ağ bozulduğunda neyin geciktiğini, neyin yeniden denendiğini ve hangi durumda güvenli şekilde başarısız olduğumuzu ölçebiliyoruz.”

---

## 9. M5 — Kullanıcı telefondan tam akışı kullanıyor

**Bu aşamanın sorusu:** “Kullanıcı bir cümleyle istek gönderip sonucu telefonunda ve gerçek takviminde görebiliyor mu?”

**Çalışan çıktı:** Flutter uygulaması, Dart ajanı, doğal dil isteği, anlamsal keşif ve Google Calendar entegrasyonu.

**Büyüklük notu:** Bu aşama diğerlerinden daha geniştir; bu nedenle yedi issue'ya bölündü. MM-501 erişim kontrolü erken, MM-504 doğal dil adaptörü mobil arayüzden bağımsız başlayabilir. Böylece bütün AI ve mobil riski en sona yığılmaz.

**Teknik dayanak:** Flutter, WebSocket üzerinden çift yönlü iletişim için resmi örnek sunuyor. Google Calendar'da müsaitlik sorgulama ve etkinlik oluşturma ayrı API işlemleridir. Android APK derleme için ayrıca Android araç zinciri kurulumu gerekir. [W4][W5][W6][W7]

### MM-501 — Flutter iskeletini ve iOS / Android derlemelerini doğrula

**GitHub başlığı:** `[M5][MM-501] Flutter iskeletini ve iOS / Android derlemelerini doğrula`  
**Bağımlılıklar:** Başlamak için MM-101; M1 sırasında yapılabilir  
**Etiketler:** `mobile`, `test`

**Amaç / çıktı:** Android APK sorunu henüz boş uygulama aşamasında çözülmüş, iki platformda açılan bir başlangıç uygulaması.

**Yapılacaklar:** Flutter uygulamasını oluştur. `flutter doctor -v` çıktısından Android SDK, command-line tools, lisanslar ve Java / Gradle uyumunu teşhis et. Gerekli araçları kurup lisansları doğrula; sorun çözülmeden körlemesine proje dosyası değiştirme. API adresi / ortam seçimini konfigürasyona taşı. iOS mevcut kurulumu da smoke test et.

**Kabul kriterleri:**
- [ ] `flutter analyze` ve başlangıç testleri geçiyor.
- [ ] iOS uygulaması simülatör veya cihazda açılıyor; kullanılan hedef kaydediliyor.
- [ ] `flutter build apk --debug` başarıyla çalışıyor ve üretilen APK Android cihaz / emülatöre kurulup açılıyor.
- [ ] Android derlemesi engelliyse gerçek hata ve çözüm adımı issue'da var; yalnız iOS çalışıyor diye iki platform tamamlandı sayılmıyor.
- [ ] Demo için debug APK yeterli olduğu belirtiliyor; mağaza yayını / dağıtım imzalama bu issue'nun zorunlu kapsamı değil.

**Kanıt:** Temizlenmiş doctor çıktısı, iki platformun açılış kanıtı, APK build logu ve kurulum sonucu. [W6][W7]

### MM-502 — Dart ajanını ve Node–Dart protokol uyumluluğunu uygula

**GitHub başlığı:** `[M5][MM-502] Dart ajanını ve Node–Dart protokol uyumluluğunu uygula`  
**Bağımlılıklar:** MM-501, MM-204, MM-304  
**Etiketler:** `mobile`, `agent`, `protocol`, `security`

**Amaç / çıktı:** Flutter uygulaması yalnız ekran değil, aynı protokolü konuşan gerçek bir ajan olsun.

**Yapılacaklar:** Şema / MAC test vektörlerine uyan Dart taşıma, kalıcı inbox/outbox, tekrar kontrolü ve müzakere modüllerini oluştur. Deterministik seçim mantığını ortak fixture'larla Dart'a uygula; TypeScript dosyalarını doğrudan import etmeye çalışma. Ajan çekirdeğini UI'dan ayır; ağ deneyleri için Dart test harness'iyle de çalıştırılabilsin. Kimlik bilgilerini güvenli cihaz depolamasında tut.

**Kabul kriterleri:**
- [ ] Node'da üretilen geçerli mesaj Dart tarafından, Dart mesajı Node tarafından doğrulanıyor; MAC test vektörleri eşleşiyor.
- [ ] Aynı takvim / tercih fixture'larında iki uygulama aynı aday, puan ve kararı üretiyor.
- [ ] Bir Dart + iki Node ajanı M3 temel senaryosunu tamamlıyor.
- [ ] Flutter kapatılıp yeniden açılınca aynı kimlik / kalıcı durum ile devam ediyor; duplicate iş etkisi oluşmuyor.
- [ ] Telefon ve Node süreçleri aynı ajan kimliğiyle aynı anda iki bağımsız karar verici olarak çalışmıyor; session devri açık.

**Kanıt:** Karşılıklı conformance raporu, karma istemci demosu ve uygulama yeniden açma testi. [W4]

### MM-503 — Profil, arkadaşlar, toplantı ve takvim ekranlarını bağla

**GitHub başlığı:** `[M5][MM-503] Profil, arkadaşlar, toplantı ve takvim ekranlarını bağla`  
**Bağımlılıklar:** MM-501, MM-502, MM-201  
**Etiketler:** `mobile`, `agent`, `test`

**Amaç / çıktı:** Kullanıcı ajan bulabilsin, toplantı başlatabilsin ve hangi aşamada olduğunu anlayabilsin.

**Yapılacaklar:** Profil / bulunabilirlik, arkadaş arama ve ilişki onayı, yapılandırılmış toplantı formu, gelen öneriyi kabul / reddetme, toplantı detayı ve takvim görünümü oluştur. Basit demo hesapları kullanılabilir; herkesin istediği agentId'ye serbestçe geçmesi kimlik doğrulama sayılmaz. İlk mobil akış LLM olmadan da formdan çalışsın.

**Kabul kriterleri:**
- [ ] Kullanıcı katılımcı, tarih aralığı, süre ve saat dilimini formdan seçerek gerçek protokol akışını başlatıyor.
- [ ] Alıcı öneriyi kabul / reddedebiliyor; cevabı mesaj akışında görülüyor.
- [ ] Arayüz 'kuyrukta', 'karşı taraf bekleniyor', 'onay bekleniyor', 'takvime yazılıyor', 'tamamlandı' ve 'başarısız' durumlarını ayırıyor.
- [ ] Private ajan yanlış kullanıcıda görünmüyor; arkadaşlık kabul edilmeden friends erişimi açılmıyor.
- [ ] Bağlantı kesilince durum görünür; uygulama yeniden açıldığında eski ekran durumunu başarı diye göstermeden güncel durumu eşitliyor.

**Kanıt:** İki kullanıcıyla ekran kaydı ve UI → agent → hub olaylarını aynı meetingId ile eşleyen log.

### MM-504 — Doğal dil isteğini güvenli ve doğrulanmış REQUEST'e dönüştür

**GitHub başlığı:** `[M5][MM-504] Doğal dil isteğini güvenli ve doğrulanmış REQUEST'e dönüştür`  
**Bağımlılıklar:** MM-102, MM-301; MM-503 mobil bağlantı için, CLI prototipi için zorunlu değil  
**Etiketler:** `ai`, `backend`, `test`

**Amaç / çıktı:** Türkçe isteği katılımcı / süre / tarih aralığı / tercihlere çeviren gerçek model adaptörü.

**Yapılacaklar:** Model çağrısını anahtarları saklayan sunucu adaptörüne koy. Girdiye sabit referans tarih ve saat dilimi sağla; çıktıyı JSON şeması ve iş kurallarıyla doğrula. Katılımcı adlarını Directory ile çöz; modelin uydurduğu agentId'yi kabul etme. Belirsiz istekte kullanıcıya soru / düzenlenebilir önizleme göster. Kullanıcı önizlemeyi onaylamadan toplantı başlatma.

**Kabul kriterleri:**
- [ ] 12 açık Türkçe istekten en az 11'i beklenen katılımcı, süre ve tarih aralığını doğru çıkarıyor; 12'sinde de doğrulama dışı çıktı sessizce çalıştırılmıyor.
- [ ] 4 belirsiz örneğin 4'ünde eksik / çelişkili bilgi görünür; model kendi başına kritik tarih / kişi seçip işlem yapmıyor.
- [ ] 4 yetki aşımı / talimat enjeksiyonu örneğinin 4'ünde takvim dışa aktarma, başka kullanıcıya geçme veya doğrulama atlama gerçekleşmiyor.
- [ ] Model erişilemezken açıklayıcı hata ve yapılandırılmış form alternatifi var; form sonucu AI sonucu diye sayılmıyor.
- [ ] Gerçek model koşusu, model tanımı / prompt sürümü / başarı oranıyla kaydediliyor; mock yalnız CI için açıkça etiketli.

**Kanıt:** 20 örneklik değerlendirme dosyası, beklenen / gerçek alan karşılaştırması, CLI veya mobil doğal dil demosu.

### MM-505 — Agent Directory'ye anlamsal yetenek araması ekle

**GitHub başlığı:** `[M5][MM-505] Agent Directory'ye anlamsal yetenek araması ekle`  
**Bağımlılıklar:** MM-201, MM-204  
**Etiketler:** `ai`, `backend`, `test`

**Amaç / çıktı:** İsim eşleşmesi dışında, yetenek açıklamasının anlamına göre yetkili ajanları bulabilmek.

**Yapılacaklar:** Yetenek açıklamaları için çok dilli embedding adaptörü ekle. Küçük veri setinde basit vektör benzerliği yeterli; ilk sürümde ayrı vektör veritabanı zorunlu değil. Profil değişiminde embedding / cache güncelle. Yetki filtresini arama sonucundan önce uygula; önbellekten dönen sonuçlarda da güncel yetkiyi kontrol et. İsim / sabit kimlik aramasını koru.

**Kabul kriterleri:**
- [ ] En az 30 sentetik ajan / yetenek kaydı ve 15 beklenen hedefi etiketli sorgu var.
- [ ] Önceden ayrılmış 15 test sorgusunun en az 12'sinde beklenen yetkili ajan ilk 3 sonuçta; veri / prompt ayarı test sonucuna göre gizlice değiştirilmemiş.
- [ ] Yetkisiz profil, ID ile sorguda, anlam aramasında, sonuç sayısında veya önbellekte açığa çıkmıyor.
- [ ] Embedding üretimine mevcut takvim başlıkları veya kişisel etkinlik içeriği gönderilmiyor.
- [ ] Model servisi erişilemezse tam isim / kimlik araması çalışıyor; bunun semantic arama olmadığı açık.

**Kanıt:** Etiketli veri seti, hit@3 hesabı, yetki testleri ve iki örnek anlamsal arama çıktısı.

### MM-506 — Google Calendar yetkilendirme, free/busy ve tekil yazımı entegre et

**GitHub başlığı:** `[M5][MM-506] Google Calendar yetkilendirme, free/busy ve tekil yazımı entegre et`  
**Bağımlılıklar:** MM-301, MM-304, MM-502  
**Etiketler:** `calendar`, `security`, `test`

**Amaç / çıktı:** Sahte sağlayıcı yerine açıkça izin veren kullanıcıların gerçek takvimleriyle çalışmak.

**Yapılacaklar:** Platforma uygun OAuth akışını, okuma / yazma için gereken kapsamları ve yetki iptalini uygula. Google adaptörünü aynı takvim arayüzüne bağla. Müsaitliği Freebusy üzerinden al; her ajan yalnız yetkilendirildiği takvime yazsın. İlk sürümde her kullanıcı takvimine ayrı bir kayıt modeli kullan; bunun üstüne ayrıca otomatik davet gönderip ikinci kopya yaratma. Google biçimine uygun kararlı event ID / meeting eşlemesi ve sorgulayarak uzlaştırma ekle.

**Kabul kriterleri:**
- [ ] En az iki gerçek, izin verilmiş test hesabında müsaitlik okunuyor; ham mevcut etkinlik başlıklarını okumak / başka ajana göndermek gerekmiyor.
- [ ] Bu iki hesap aynı gerçek entegrasyon toplantısında onay sonrası aynı saate birer etkinlik alıyor.
- [ ] Aynı yazım tekrarlandığında veya ilk yazımın cevabı kaybolduğunda aynı etkinlik sorgulanıp uzlaştırılıyor; yeni rastgele ID ile ikinci etkinlik açılmıyor.
- [ ] Bir hesapta yazma izni yok / token iptal edilmişse genel ekran tamamlandı demiyor; hangi hesabın yeniden yetki istediği görünür.
- [ ] Google dışarıdan değişmiş takvimi atomik olarak kilitliyormuş gibi davranılmıyor: onay öncesi yeniden kontrol yapılıyor; kalan dış değişiklik yarışı sınırlama olarak yazılıyor.
- [ ] Sentetik test ile canlı Google testi ayrı raporlanıyor; gerçek etkinliklerin temizliği kullanıcı onayı ve test kimlikleriyle sınırlı.

**Kanıt:** İki hesaptaki test etkinliği kanıtı, token-iptal ve kayıp-yanıt testi; temizlenmiş API sonuçları. [W5][W8]

### MM-507 — Uçtan uca mobil demoyu ve final regresyonunu tamamla

**GitHub başlığı:** `[M5][MM-507] Uçtan uca mobil demoyu ve final regresyonunu tamamla`  
**Bağımlılıklar:** MM-501–506, M4 geçişi  
**Etiketler:** `mobile`, `test`, `docs`

**Amaç / çıktı:** Telefondaki kullanıcı isteğinden takvim kaydına kadar tam sistem ve güvenilir final kanıtı.

**Yapılacaklar:** `demo:m5` ve `test:gate:m5` oluştur. Bir iOS ve bir Android istemcinin ortak senaryosunu çalıştır; simülatör / emülatör kullanıldıysa açıkça yaz. En az iki gerçek takvimli akış ile üç ajanlı fixture akışını ayrı göster. M4'teki temel bozulma testlerini en az bir Dart ajan çekirdeği içeren deneyle tekrar et. Sonuçları rapora hazır bir kanıt dizinine topla.

**Kabul kriterleri:**
- [ ] Türkçe istek → önizleme / onay → Directory → müzakere → katılımcı onayları → gerçek takvim kayıtları aynı meetingId üzerinden izleniyor.
- [ ] iOS ve Android derleme / kurulum kanıtı var; Android için APK çıktısı gerçekten kurulmuş.
- [ ] Karma Node/Dart deneyinde N0, N3 ve N4 ilgili tekrar sayılarıyla yeniden geçiyor; yalnız Node ölçümünün Flutter için de doğrulandığı varsayılmıyor.
- [ ] Gerçek Google akışında iki hesapta tekil kayıt var; üç gerçek Google hesabı kullanılmadıysa üç hesaplı canlı entegrasyon yapıldı denmiyor.
- [ ] LLM, Calendar veya Air erişilemezse demo durumu dürüstçe gösteriyor; önceki kayıt / fixture geçişi açık etiketli.
- [ ] Final kanıt listesinde protokol, keşif, AI değerlendirmesi, gizlilik, mobil ve ağ ölçümleri ayrı ayrı mevcut.

**Kanıt:** `docs/evidence/m5/`, test özeti, APK / iOS çalışma kanıtı, kısa uçtan uca kayıt ve `m5-demo` etiketi.

### M5 geçiş testi — Tam sistem bunlar olmadan bitmiş sayılmaz

| Test | Uygulama | Gözlemlenecek sonuç |
|---|---|---|
| M5-T1 | iOS ve Android uygulamasını aç | İki platformda gerçek çalışan istemci |
| M5-T2 | Türkçe toplantı isteği gir | Doğrulanmış, düzenlenebilir istek önizlemesi |
| M5-T3 | Katılımcıyı / yeteneği ara | Tam kimlik çözümü ve ayrıca çalışan anlamsal arama |
| M5-T4 | İsteği gönder; diğer kullanıcı kabul eder | Protokol adımları ve doğru durum geçişleri görünür |
| M5-T5 | İki gerçek takvime yaz | Aynı saatte birer etkinlik; onaydan önce kayıt yok |
| M5-T6 | Uygulamayı kapat / tekrar aç | Offline → kuyruk → durum senkronizasyonu; mükerrer kayıt yok |
| M5-T7 | Calendar yetkisini iptal et / LLM erişimini kes | Açık hata veya etiketli fallback; sahte tamamlanma yok |
| M5-T8 | Bir Dart ajanıyla N0 / N3 / N4 tekrar et | Referans Node davranışıyla aynı güvenilirlik özellikleri |

- [ ] İki platformda çalışan uygulama var; APK kurulumu doğrulandı.
- [ ] Gerçek LLM ve embedding değerlendirmeleri hedefleri karşılıyor.
- [ ] En az iki gerçek Google hesabıyla uçtan uca toplantı testi geçiyor.
- [ ] Üç ajanlı fixture demosu ve karma istemci regresyonları geçiyor.
- [ ] Kaynak belgelerdeki iki ana katkı — Agent Directory ve Agent Communication Layer — demoda ayrı ayrı görünür.
- [ ] Kod, kanıt, rapor tabloları ve `m5-demo` etiketi aynı sürümü referanslıyor.

**Aşama sonunda söylenecek cümle:** “Kullanıcı telefondan doğal dille toplantı istiyor; ajanlar uygun saatte anlaşıyor ve onaylanan toplantı gerçek takvimlere ekleniyor.”

---

## 10. Gereklilik → issue → kanıt eşlemesi

Bu tablo, mobil ekranlar tamamlanırken projenin ağ / ajan katkısının unutulmaması için kullanılır.

| Gereklilik | Ana issue'lar | Beklenen kanıt |
|---|---|---|
| Altı standart ajan mesajı | MM-102–105, MM-502 | Şema / taşıma / Node–Dart uyumluluk testleri |
| Sabit ajan kimliği ve güncel erişim | MM-202 | Session değişimi ve heartbeat testleri |
| İsim / yetenek ile keşif | MM-201, MM-505 | Kesin arama + anlamsal arama değerlendirmesi |
| Kısa TTL ve bulunabilirlik kontrolü | MM-201, MM-505 | Cache invalidation ve yetki matrisi |
| ACK, timeout, yeniden gönderim | MM-104, MM-203, MM-403 | ACK kaybı, yeniden gönderim ve tek iş etkisi |
| Çevrimdışı kuyruk | MM-203, MM-205, MM-404 | Offline + hub restart + geri dönüş |
| TLS, MAC ve nonce | MM-204, MM-502 | Pozitif / negatif güvenlik ve ortak test vektörleri |
| Ortak saat ve tercih puanlama | MM-301–305 | Beklenen slot, toplam puan, eşitlik / ret testleri |
| Herkesin onayı ve güvenli takvim yazımı | MM-303–304, MM-506 | Eksik onayda 0 kayıt; tekrar yazımda tek kayıt |
| Doğal dili yapılandırılmış isteğe çevirme | MM-504 | Gerçek modelle 20 örneklik değerlendirme |
| Google Calendar müsaitlik / etkinlik | MM-506 | En az iki izinli gerçek hesapla entegrasyon |
| Profil, arkadaş, istek ve takvim ekranı | MM-501–503, MM-507 | İki platformda çalışan mobil akış |
| Kötü ağda davranışın ölçümü | MM-401–405, MM-507 | N0–N8 ham sonuçları; Dart ile seçili tekrarlar |
| Tam takvimi paylaşmama | MM-301, MM-305, MM-505–506 | Payload / log canary testleri ve yetki kontrolleri |

---

## 11. Sunum ve final için çalışma sırası

### 11.1. İlk açılacak issue'lar

**Çekirdek geliştirme:** MM-101 → MM-102 → MM-103 → MM-104 → MM-105.

**Bununla paralel risk azaltma:** MM-401 Air erişim kontrolü ve MM-501 boş Flutter uygulamasının iki platformda derlenmesi.

Bunlar bitince M2'nin keşif / oturum / kuyruk işleri, ardından M3'ün gerçek müzakere işleri gelir. MM-301 fixture ve adaptör tasarımı, arayüzler net olduğunda M2 ile kısmen paralel yürütülebilir.

**AI prototipi:** MM-504, mesaj şeması ve zaman modeli hazır olduğunda CLI üzerinden başlayabilir. Mobil ekranlara bağımlı değildir.

### 11.2. 10. hafta sunumu

Sunumun 10. haftada olduğu ekip tarafından belirtilmiştir; kesin gün burada çıkarılmamıştır. Ders belgesindeki sunum sınırı 30 dakikadır. [P2][P3]

Önerilen sunum hedefi: **M4'e kadar çalışan ve ölçülen çekirdek + en az bir gerçek AI çıktısı + mevcut mobil ilerleme.** Bu bir teslim kapsamı değişikliği veya hocanın onayladığı asgari paket değildir.

M5 henüz bitmemişse bunu özellik bazında açıkça gösterin. Yalnızca Node ve sahte takvim demosunu “tam mobil AI uygulaması” olarak adlandırmayın. Yalnızca LLM'in bir cümleye cevap vermesini de çalışan ajan iletişim katmanı yerine koymayın.

Örnek gösterim sırası:

1. Üç ajan normal koşullarda ortak saat seçer.
2. C kapatılır; onun mesajının kuyrukta beklediği görülür.
3. C geri gelir; aynı toplantı mükerrer kayıt olmadan tamamlanır.
4. Ağ deneylerinin başarı / süre / hata sonuçları gösterilir.
5. Doğal dil isteğinin aynı protokole nasıl dönüştüğü ve mevcut mobil durum gösterilir.

**Final:** Kaynak yönergedeki son rapor tarihi 25 Aralık 2026'dır; kod ve sonuçlar raporda yer almalıdır. [P2] Bu doküman, aradaki haftalara uydurma takvim tarihleri veya gerçekçi olmayan iş günü tahminleri atamaz.

### 11.3. İki kişilik ekip için çalışma biçimi

Bir kişi protokol / hub ağırlıklı, diğeri test fixture'ları / demo / mobil hazırlık ağırlıklı ilerleyebilir; fakat tek kişi hem yazıp hem test sonucu kabul eden kişi olmamalıdır. Her milestone demosunu, o kısmı yazmayan ekip üyesi README'den çalıştırmalıdır.

---

## 12. Kapsamı büyütmemek için ilk sürümde yapılmayacaklar

Bunlar kaynak gereklilikleri iptal etmez; ek ürün geliştirmelerini sınırlar.

- Yeni TCP, IP, Wi-Fi veya fiziksel katman implementasyonu.
- Gerçek 5G radyo / handover simülasyonu iddiası.
- Sınırsız arka plan mobil çalışma, push ile ajan uyandırma ve mağaza yayını.
- Tekrarlayan toplantılar, oda rezervasyon hizmeti, ödeme, sohbet veya görüntülü görüşme sistemi.
- Kurumsal çok kiracılı anahtar yönetimi, global ölçek, yüzlerce ajanlı performans hedefi.
- Başlangıçtan itibaren ayrı mikroservis, Redis ve vektör DB zorunluluğu.
- LLM'e takvim / yetki kurallarını atlatabilecek doğrudan işlem yetkisi.

**Kapsam dışında olmayanlar:** Güvenlik testleri, kalıcı kuyruk, duplicate önleme, gerçek AI değerlendirmesi, gerçek takvim entegrasyonu ve Android derleme doğrulaması. Bunlar “zaman kalırsa” işlerine dönüştürülmemelidir.

---

## 13. Boş kanıt şablonu

Her milestone için bu bölümü kopyalayın. Değerler testten sonra doldurulur.

```text
Milestone:
Test / demo kimliği:
Tarih:
Commit / tag:
Çalıştıran:
İnceleyen:
Ortam / platform:
Runtime / SDK sürümleri:
Fixture / profil sürümü:
Çalıştırma komutu:
Beklenen:
Gözlenen:
Koşu sayısı:
Başarılı / başarısız / timeout:
Yanlış başarı sayısı:
Mükerrer kayıt sayısı:
Log / video / ham veri yolu:
Bilinen sınırlamalar:
Sonuç: PASS / FAIL / BLOCKED
```

Bir testte beklenen sonucun başarısızlık olması, testin başarısız olduğu anlamına gelmez. Örneğin sürekli offline katılımcı için doğru sonuç açık EXPIRED / ABORT olabilir. Buna karşılık eksik onayla CONFIRMED görünmesi kritik uygulama hatasıdır.

### Genel ilerleme

- [ ] M1 — Ajanlar konuşuyor.
- [ ] M2 — Ajanlar bulunuyor; çevrimdışı mesajlar korunuyor.
- [ ] M3 — Ajanlar gerçek algoritmayla ortak saat seçiyor.
- [ ] M4 — Bozuk ağ davranışı ölçülüyor ve kanıtlanıyor.
- [ ] M5 — Flutter + AI + gerçek takvim akışı tamamlanıyor.

**Başlangıç durumu: 0/5.** Bu işaretler mevcut kod deposunun incelenmesine dayanmaz; planın boş takip şablonudur.

---

## 14. Kaynaklar ve kararların kökeni

### Proje kaynakları

**[P1] `CSE476_MeetMash_Proposal.pdf`**  
19 Ekim 2026 tarihli öneri. Sayfa 1, bölümler 2–5: amaç, kapsam, protokol, güvenlik, AI ve başarı kriterleri. Sayfa 2: Directory / Registrar ayrımı ve katman mimarisi.

**[P2] `CSE 476 575 F26 Term project guidelines.pdf`**  
Ders yönergesi. Sayfa 1: kod yazma zorunluluğu, AI/ML ve mobil iletişim odağı, sunum / rapor şartları.

**[P3] `MeetMesh_Project_Context.md` ve bu konuşmadaki ekip kararları**  
Sunumun 10. hafta olması; beş ana geliştirme adımı; Flutter tercihi ve Android APK derleme sorunu. Context dosyasının kendisi bir ilerleme raporu değildir.

### Yalnız uygulama yapılabilirliğini doğrulamak için kullanılan dış teknik belgeler

Bu kaynaklar projenin zorunlu kapsamını belirlemez. Erişim bilgileri ve dokümantasyon 4 Kasım 2026'da kontrol edilmiştir; platform erişimi ekip hesabında ayrıca doğrulanmalıdır.

**[W1] NVIDIA DSX Air — Custom Topology**  
Özel topoloji, sunucu düğümleri ve topoloji dosyası desteği.  
`https://docs.nvidia.com/dsx-air/custom-topology`

**[W2] NVIDIA DSX Air — Account Setup**  
NGC hesabı / organizasyonu, giriş ve uygunluğa bağlı deneme erişimi.  
`https://docs.nvidia.com/dsx-air/account-setup`

**[W3] Linux Kernel Documentation — tc netlink specification**  
NetEm gecikme, jitter, kayıp ve paket çoğaltma parametreleri.  
`https://origin.kernel.org/doc/html/next/netlink/specs/tc.html`

**[W4] Flutter — Communicate with WebSockets**  
Dart / Flutter tarafında çift yönlü WebSocket iletişimi.  
`https://docs.flutter.dev/cookbook/networking/web-sockets`

**[W5] Google Calendar API — Freebusy: query**  
Takvim müsaitlik sorgusu ve busy aralıklarının biçimi.  
`https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query`

**[W6] Flutter — Set up Android development**  
Android geliştirme araç zinciri.  
`https://docs.flutter.dev/platform-integration/android/setup`

**[W7] Flutter — Build and release an Android app**  
APK üretimi ve Android derleme çıktıları.  
`https://docs.flutter.dev/deployment/android`

**[W8] Google Calendar API — Events: insert**  
Etkinlik oluşturma, yetkilendirme ve sağlanan event ID'nin biçim kuralları.  
`https://developers.google.com/workspace/calendar/api/v3/reference/events/insert`

### Kaynak ile tasarım arasındaki sınır

Issue sayısı, depo düzeni, WSS relay uyarlaması, SQLite / PostgreSQL seçimi, durum makinesi ayrıntıları, MAC testleri, deney eşikleri ve kabul sayıları **bu dokümanın önerdiği uygulama tasarımıdır**. Bunlar kaynak metinlerde aynen bulunan şartlarmış gibi alıntılanmamalıdır.

Bu dosya oluşturulurken kod deposu incelenmedi, uygulama yazılmadı, Air hesabı açılmadı, Google takvimine erişilmedi ve GitHub'da issue oluşturulmadı.
