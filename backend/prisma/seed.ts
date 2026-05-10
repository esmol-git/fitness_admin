import { ClientStatus, Gender, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const DEMO_CLIENTS_TAG = 'demo_clients_seed_v1';
const DEMO_CLIENTS_TARGET = 50;

function composeName(
  lastName: string,
  firstName: string,
  middleName?: string | null,
) {
  return [lastName, firstName, middleName]
    .filter((v) => typeof v === 'string' && v.trim().length > 0)
    .join(' ');
}

async function seedDemoClientsWithoutContracts(
  managerId: string,
  membershipTypeFallback: string | null,
) {
  const existing = await prisma.client.count({
    where: { notes: { contains: DEMO_CLIENTS_TAG } },
  });
  const need = Math.max(0, DEMO_CLIENTS_TARGET - existing);
  if (need === 0) {
    console.log(
      `Demo clients already at ${DEMO_CLIENTS_TARGET} (${existing} tagged), skip.`,
    );
    return;
  }

  const lastNames = [
    'Иванов',
    'Петров',
    'Сидоров',
    'Козлов',
    'Новиков',
    'Морозов',
    'Волков',
    'Соколов',
    'Лебедев',
    'Егоров',
    'Павлов',
    'Семёнов',
    'Голубев',
    'Виноградов',
    'Богданов',
    'Фёдоров',
    'Михайлов',
    'Белов',
    'Тарасов',
    'Комаров',
    'Орлов',
    'Андреев',
    'Макаров',
    'Николаев',
    'Захаров',
    'Зайцев',
    'Соловьёв',
    'Борисов',
    'Яковлев',
    'Григорьев',
    'Романов',
    'Осипов',
    'Степанов',
    'Фомин',
    'Давыдов',
    'Жуков',
    'Поляков',
    'Симонов',
    'Журавлёв',
    'Одинцов',
    'Мартынов',
    'Кузнецов',
    'Фролов',
    'Александров',
    'Дмитриев',
    'Королёв',
    'Гусев',
    'Зиновьев',
    'Титов',
    'Кудрявцев',
    'Баранов',
  ];

  const firstNamesM = [
    'Александр',
    'Дмитрий',
    'Максим',
    'Иван',
    'Артём',
    'Михаил',
    'Даниил',
    'Кирилл',
    'Андрей',
    'Егор',
    'Илья',
    'Алексей',
    'Матвей',
    'Никита',
    'Роман',
    'Тимофей',
    'Владимир',
    'Глеб',
    'Денис',
    'Павел',
    'Сергей',
    'Олег',
    'Виктор',
    'Константин',
    'Степан',
    'Ярослав',
    'Григорий',
    'Лев',
    'Фёдор',
    'Борис',
    'Георгий',
    'Пётр',
    'Василий',
    'Станислав',
    'Тарас',
    'Юрий',
    'Игорь',
    'Руслан',
    'Антон',
    'Валентин',
    'Дамир',
    'Захар',
    'Клим',
    'Лев',
    'Марк',
    'Николай',
    'Оскар',
    'Платон',
    'Ростислав',
    'Савва',
    'Тигран',
  ];

  const firstNamesF = [
    'Анна',
    'Мария',
    'Елена',
    'Дарья',
    'Алина',
    'Ирина',
    'Екатерина',
    'Ольга',
    'Татьяна',
    'Наталья',
    'Виктория',
    'Полина',
    'София',
    'Ксения',
    'Юлия',
    'Валерия',
    'Вероника',
    'Марина',
    'Светлана',
    'Алиса',
    'Диана',
    'Кристина',
    'Людмила',
    'Надежда',
    'Оксана',
    'Регина',
    'Ульяна',
    'Яна',
    'Анастасия',
    'Елизавета',
    'Жанна',
    'Зоя',
    'Инна',
    'Клавдия',
    'Лариса',
    'Маргарита',
    'Нина',
    'Олеся',
    'Раиса',
    'Тамара',
    'Фаина',
    'Элина',
    'Юлиана',
    'Ярослава',
    'Агата',
    'Бронислава',
    'Василиса',
    'Галина',
    'Домника',
    'Евгения',
    'Жанна',
  ];

  const patronymicsM = [
    'Александрович',
    'Дмитриевич',
    'Сергеевич',
    'Иванович',
    'Андреевич',
    'Михайлович',
    'Павлович',
    'Николаевич',
    'Владимирович',
    'Олегович',
    'Егорович',
    'Игоревич',
    'Романович',
    'Васильевич',
    'Константинович',
    'Фёдорович',
    'Юрьевич',
    'Борисович',
    'Викторович',
    'Геннадьевич',
    'Денисович',
    'Евгеньевич',
    'Захарович',
    'Кириллович',
    'Львович',
    'Максимович',
    'Никитич',
    'Олегович',
    'Петрович',
    'Семёнович',
    'Тимофеевич',
    'Федорович',
    'Артёмович',
    'Богданович',
    'Валерьевич',
    'Григорьевич',
    'Данилович',
    'Ефимович',
    'Зиновьевич',
    'Ильич',
    'Кузьмич',
    'Леонидович',
    'Маркович',
    'Платонович',
    'Ростиславович',
    'Савельевич',
    'Тихонович',
    'Владиславович',
    'Анатольевич',
    'Вячеславович',
    'Георгиевич',
    'Давыдович',
  ];

  const patronymicsF = [
    'Александровна',
    'Дмитриевна',
    'Сергеевна',
    'Ивановна',
    'Андреевна',
    'Михайловна',
    'Павловна',
    'Николаевна',
    'Владимировна',
    'Олеговна',
    'Егоровна',
    'Игоревна',
    'Романовна',
    'Васильевна',
    'Константиновна',
    'Фёдоровна',
    'Юрьевна',
    'Борисовна',
    'Викторовна',
    'Геннадьевна',
    'Денисовна',
    'Евгеньевна',
    'Кирилловна',
    'Максимовна',
    'Никитична',
    'Петровна',
    'Семёновна',
    'Тимофеевна',
    'Артёмовна',
    'Богдановна',
    'Валерьевна',
    'Григорьевна',
    'Даниловна',
    'Ефимовна',
    'Ильинична',
    'Леонидовна',
    'Марковна',
    'Платоновна',
    'Савельевна',
    'Тихоновна',
    'Владиславовна',
    'Анатольевна',
    'Вячеславовна',
    'Георгиевна',
    'Давыдовна',
    'Елисеевна',
    'Захаровна',
    'Ивановна',
    'Климовна',
    'Львовна',
  ];

  const streets = [
    'ул. Тверская',
    'ул. Арбат',
    'пр-т Мира',
    'ул. Ленина',
    'ул. Пушкина',
    'наб. Реки Москвы',
    'ул. Садовая',
    'ул. Большая Дмитровка',
    'ул. Бутырская',
    'ул. Профсоюзная',
  ];

  for (let i = 0; i < need; i += 1) {
    const serial = existing + i + 1;
    const idx = serial - 1;
    const gender: Gender = idx % 2 === 0 ? 'MALE' : 'FEMALE';
    const lastName = lastNames[idx % lastNames.length];
    const firstName =
      gender === 'MALE'
        ? firstNamesM[idx % firstNamesM.length]
        : firstNamesF[idx % firstNamesF.length];
    const middleName =
      gender === 'MALE'
        ? patronymicsM[idx % patronymicsM.length]
        : patronymicsF[idx % patronymicsF.length];
    const name = composeName(lastName, firstName, middleName);
    const birthYear = 1988 + (idx % 18);
    const birthMonth = 1 + (idx % 12);
    const birthDay = 1 + (idx % 28);
    const birthDate = new Date(Date.UTC(birthYear, birthMonth - 1, birthDay));
    const phone = `+7${9011000000 + serial}`;
    const email = `demo.client.${String(serial).padStart(4, '0')}@seed.local`;
    const passport = `${4500 + (idx % 80)} ${String(100000 + idx).slice(-6)}`;
    const address = `г. Москва, ${streets[idx % streets.length]}, д. ${10 + (idx % 90)}, кв. ${1 + (idx % 200)}`;
    const cardNumber = `SEED-${String(serial).padStart(5, '0')}`;
    const accessKey = `KEY${String(serial).padStart(6, '0')}`;
    const notes = `Демо-клиент без договора · ${DEMO_CLIENTS_TAG} · #${serial}`;
    const status: ClientStatus =
      idx % 17 === 0 ? 'PAUSED' : idx % 23 === 0 ? 'INACTIVE' : 'ACTIVE';

    await prisma.client.create({
      data: {
        name,
        firstName,
        lastName,
        middleName,
        gender,
        birthDate,
        phone,
        email,
        passport,
        address,
        notes,
        status,
        cardNumber,
        accessKey,
        membershipType: membershipTypeFallback,
        contractNumber: null,
        contractStartDate: null,
        contractEndDate: null,
        paymentDate: null,
        photoUrl: null,
        manager: { connect: { id: managerId } },
      },
    });
  }

  console.log(
    `Seeded ${need} demo client(s) (${DEMO_CLIENTS_TAG}), всего с тегом: ${existing + need}, без договоров.`,
  );
}

async function main() {
  const password = await bcrypt.hash('Admin123!', 12);
  const email = 'admin@fitness.local';
  const login = 'admin';

  const existing =
    (await prisma.user.findUnique({ where: { login } })) ??
    (await prisma.user.findUnique({ where: { email } }));

  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        login,
        email,
        password,
        firstName: 'Админ',
        lastName: 'Фитнес',
        position: 'Администратор',
      },
    });
  } else {
    await prisma.user.create({
      data: {
        login,
        email,
        password,
        role: 'ADMIN',
        isEmployee: true,
        firstName: 'Админ',
        lastName: 'Фитнес',
        position: 'Администратор',
      },
    });
  }

  const themeCount = await prisma.themeSettings.count();
  if (themeCount === 0) {
    await prisma.themeSettings.create({
      data: { defaultPreset: 'blue', defaultLocale: 'ru' },
    });
  }

  const adminUser = await prisma.user.findUnique({
    where: { login },
    select: { id: true },
  });
  const catalogRow = await prisma.membershipCatalog.findFirst({
    where: { isActive: true },
    select: { id: true },
    orderBy: { name: 'asc' },
  });
  const membershipTypeFallback = catalogRow?.id ?? null;

  if (adminUser) {
    await seedDemoClientsWithoutContracts(adminUser.id, membershipTypeFallback);
  } else {
    console.warn('Admin user not found; skip demo clients seed.');
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
